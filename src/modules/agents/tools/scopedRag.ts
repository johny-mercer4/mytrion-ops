/**
 * Per-child knowledge_search tool. Each child agent gets its own instance, closed over the
 * caller's context narrowed through the agent's RAG scope (effectiveRetrievalContext — the
 * exact function the RBAC-leakage suite verifies). Passages are wrapped as UNTRUSTED data.
 */
import { tool, type StructuredTool } from '@langchain/core/tools';
// zod v4 entrypoint — LangChain v1's tool() accepts it natively (classic v3 clashes with
// exactOptionalPropertyTypes on _def.description).
import * as z from 'zod/v4';
import { DEFAULT_RETRIEVAL_K, MAX_RETRIEVAL_K } from '../../../config/constants.js';
import { env } from '../../../config/env.js';
import type { WireCitation } from '../../knowledge/agentic/citationCheck.js';
import { retrieve } from '../../knowledge/retriever.js';
import { wrapUntrusted } from '../../security/untrusted.js';
import { knowledgeRepo } from '../../../repos/knowledgeRepo.js';
import { effectiveRetrievalContext } from '../authority.js';
import { requireAgentContext, type AgentRunContext } from '../context.js';
import { recallMemories } from '../memory.js';
import type { AgentManifest } from '../types.js';
import type { TenantContext } from '../../../types/tenantContext.js';

/** Report retrieved sources onto the run: collected for post-run validation + live SSE. */
function reportSources(
  run: AgentRunContext,
  passages: number,
  citations: WireCitation[],
  evidence: Array<{ marker: string; docId: string; content: string }> = [],
): void {
  if (run.collect) {
    run.collect.ragPassages = (run.collect.ragPassages ?? 0) + passages;
    const bucket = (run.collect.citations ??= []);
    for (const c of citations) {
      if (!bucket.some((b) => b.id === c.id && b.marker === c.marker)) bucket.push(c);
    }
    const evidenceBucket = (run.collect.ragEvidence ??= []);
    for (const item of evidence) {
      if (!evidenceBucket.some((existing) => existing.marker === item.marker)) evidenceBucket.push(item);
    }
  }
  run.emit?.('context', { passages, citations });
}

/** Titles for the classic (non-agentic) path — ChunkSearchResult carries no docTitle. */
async function titlesFor(ctx: TenantContext, docIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(docIds)];
  const docs = await Promise.all(unique.map((id) => knowledgeRepo.findDoc(ctx, id)));
  const map = new Map<string, string>();
  docs.forEach((doc, i) => {
    const id = unique[i];
    if (id) map.set(id, doc?.title ?? id);
  });
  return map;
}

export function buildScopedRagTool(manifest: AgentManifest, callerCtx: TenantContext): StructuredTool {
  const retrievalCtx = effectiveRetrievalContext(callerCtx, manifest);
  return tool(
    async ({ query, limit }: { query: string; limit: number }) => {
      const run = requireAgentContext();
      // Cap server-side: the model may ask for up to MAX_RETRIEVAL_K, and every passage is charged
      // as input tokens on EVERY model call for the rest of the turn, not just once.
      const k = Math.min(limit, env.RAG_MAX_PASSAGES);
      // RAG counts against the run's tool-call budget too (registry tools aren't the only path).
      run.budget?.countToolCall();
      if (env.FF_AGENTIC_RAG && env.FF_RAG_V2_RETRIEVAL) {
        const { agenticRetrieve } = await import('../../knowledge/agentic/loop.js');
        const result = await agenticRetrieve(retrievalCtx, query, {
          k,
          // The model called knowledge_search: it has already decided it wants documentation, so the
          // intent router must not answer "use a live tool instead" and abstain.
          explicitKnowledgeRequest: true,
          allowExternalSearch: Boolean(manifest.webSearch),
          // ONLY when history actually resolved a pronoun. `resolvedAsk` is otherwise the raw user
          // utterance, and `agenticRetrieve` uses it for BOTH planQueries and judgeEvidence — so
          // passing it unconditionally replaced the model's crafted keyword query with the user's
          // sentence. Measured on the Sales bench (3 runs/config): expected-doc coverage 39/42 →
          // 36/42 and mean wall +13%, because a compound ask ("check a client's balance AND see
          // their card list") retrieved the generic Agent Playbook over the specific C-8/C-24 docs,
          // graded `partial`, and burned an extra hop plus two grader calls to end up worse.
          ...(run.turnContext?.task.anaphoraResolved && run.turnContext.task.resolvedAsk
            ? { resolvedAsk: run.turnContext.task.resolvedAsk }
            : {}),
        });
        if (run.collect) {
          run.collect.rag = {
            traceId: result.traceId,
            scopeFingerprint: result.scopeFingerprint,
            mode: result.route,
            grade: result.grade,
            confidence: result.confidence,
            abstained: result.notDocumented,
          };
        }
        run.inspect?.({
          stage: 'rag',
          status: result.notDocumented ? 'complete' : 'running',
          label: result.notDocumented
            ? 'Knowledge base has no documented answer'
            : `Evidence assessed as ${result.grade}`,
          route: result.route,
          ragUsed: result.passages.length > 0,
          ragGrade: result.grade,
          confidence: result.confidence,
          passages: result.passages.length,
          details: {
            hops: result.hops,
            externalFallback: Boolean(result.webFallbackBlock),
            retrievalStrategy: env.RAG_RETRIEVAL_STRATEGY,
            traceId: result.traceId,
          },
        });
        if (result.passages.length === 0 && !result.webFallbackBlock) {
          return (
            'No relevant passages found in the knowledge base. ' +
            (result.notDocumented
              ? 'You MUST tell the user the documentation does not specify this — do not invent an answer.'
              : 'The knowledge base may lack coverage for this topic.')
          );
        }
        if (result.passages.length > 0) {
          const markerOffset = run.collect?.citations?.filter((citation) => citation.marker).length ?? 0;
          const rebased = result.citations.map((citation, index) => ({
            ...citation,
            marker: `S${markerOffset + index + 1}`,
          }));
          reportSources(
            run,
            result.passages.length,
            rebased.map((c, index) => ({
              id: c.docId,
              title: c.docTitle ?? c.docId,
              marker: c.marker,
              ...(result.passages[index]?.id ? { chunkId: result.passages[index].id } : {}),
              chunkIndex: c.chunkIndex,
              ...(c.sourceVersion ? { sourceVersion: c.sourceVersion } : {}),
              ...(c.authorityClass ? { authorityClass: c.authorityClass } : {}),
              ...(c.verificationStatus ? { verificationStatus: c.verificationStatus } : {}),
              ...(c.lastVerifiedAt ? { lastVerifiedAt: c.lastVerifiedAt } : {}),
              freshness: c.stale ? 'stale' : c.lastVerifiedAt ? 'fresh' : 'unknown',
            })),
            rebased.map((citation, index) => ({
              marker: citation.marker,
              docId: citation.docId,
              content: result.passages[index]?.content ?? '',
            })),
          );
          const rebasedBlock = result.groundingBlock.replace(/\[S(\d+)\]/g, (_whole, digits: string) =>
            `[S${markerOffset + Number(digits)}]`,
          );
          const memory = await recallMemories(retrievalCtx, manifest.key, query);
          return `${rebasedBlock}${memory}`;
        }
        const memory = await recallMemories(retrievalCtx, manifest.key, query);
        return `${result.groundingBlock}${memory}`;
      }
      const results = await retrieve(retrievalCtx, query, k);
      run.inspect?.({
        stage: 'rag',
        status: 'complete',
        label: results.length > 0
          ? `Retrieved ${results.length} knowledge passages`
          : 'Knowledge search returned no passages',
        route: 'knowledge',
        ragUsed: results.length > 0,
        passages: results.length,
        details: { retrievalStrategy: 'legacy' },
      });
      if (results.length === 0) return 'No relevant passages found in the knowledge base.';
      const titles = await titlesFor(retrievalCtx, results.map((r) => r.docId));
      reportSources(
        run,
        results.length,
        results.map((r) => ({ id: r.docId, title: titles.get(r.docId) ?? r.docId })),
      );
      const body = JSON.stringify(
        results.map((r) => ({
          docId: r.docId,
          chunkIndex: r.chunkIndex,
          score: Number(r.score.toFixed(3)),
          content: r.content,
        })),
      );
      return wrapUntrusted('kb', body);
    },
    {
      name: 'knowledge_search',
      description:
        'Search the Octane knowledge base for relevant passages (policy, product, pricing, ' +
        "how-to). Results are scoped to this agent's department access. Cite docId in citations.",
      schema: z.object({
        query: z.string().min(1).max(1000).describe('The search query'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_RETRIEVAL_K)
          .default(DEFAULT_RETRIEVAL_K)
          .describe('Maximum number of passages to return'),
      }),
    },
  ) as unknown as StructuredTool; // zod v4 tool() generics vs StructuredTool: same-package cast, safe at runtime
}
