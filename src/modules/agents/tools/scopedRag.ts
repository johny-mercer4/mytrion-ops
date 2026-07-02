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
import { retrieve } from '../../knowledge/retriever.js';
import { wrapUntrusted } from '../../security/untrusted.js';
import { effectiveRetrievalContext } from '../authority.js';
import { recallMemories } from '../memory.js';
import type { AgentManifest } from '../types.js';
import type { TenantContext } from '../../../types/tenantContext.js';

export function buildScopedRagTool(manifest: AgentManifest, callerCtx: TenantContext): StructuredTool {
  const retrievalCtx = effectiveRetrievalContext(callerCtx, manifest);
  return tool(
    async ({ query, limit }: { query: string; limit: number }) => {
      if (env.FF_AGENTIC_RAG) {
        const { agenticRetrieve } = await import('../../knowledge/agentic/loop.js');
        const result = await agenticRetrieve(retrievalCtx, query, { k: limit });
        if (result.passages.length === 0) {
          return 'No relevant passages found in the knowledge base. The knowledge base may lack coverage for this topic.';
        }
        const webHint = result.suggestWebSearch
          ? '\n\n(Coverage looks thin — if this needs public/current information, report that the knowledge base lacks coverage.)'
          : '';
        const memory = await recallMemories(retrievalCtx, manifest.key, query);
        return `${result.groundingBlock}${webHint}${memory}`;
      }
      const results = await retrieve(retrievalCtx, query, limit);
      if (results.length === 0) return 'No relevant passages found in the knowledge base.';
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
