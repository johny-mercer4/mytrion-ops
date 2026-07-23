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
function reportSources(run: AgentRunContext, passages: number, citations: WireCitation[]): void {
  if (run.collect) {
    run.collect.ragPassages = (run.collect.ragPassages ?? 0) + passages;
    const bucket = (run.collect.citations ??= []);
    for (const c of citations) {
      if (!bucket.some((b) => b.id === c.id && b.marker === c.marker)) bucket.push(c);
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
      // RAG counts against the run's tool-call budget too (registry tools aren't the only path).
      run.budget?.countToolCall();
      if (env.FF_AGENTIC_RAG) {
        const { agenticRetrieve } = await import('../../knowledge/agentic/loop.js');
        const result = await agenticRetrieve(retrievalCtx, query, {
          k: limit,
          allowWebFallback: Boolean(manifest.webSearch) || Boolean(callerCtx.allDepartmentAccess),
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
          reportSources(
            run,
            result.passages.length,
            result.citations.map((c) => ({
              id: c.docId,
              title: c.docTitle ?? c.docId,
              marker: c.marker,
            })),
          );
        }
        const memory = await recallMemories(retrievalCtx, manifest.key, query);
        return `${result.groundingBlock}${memory}`;
      }
      const results = await retrieve(retrievalCtx, query, limit);
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
