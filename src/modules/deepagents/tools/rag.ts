/**
 * RAG tool for the rag-agent subagent. Wraps the existing tenant/audience/department-scoped pgvector
 * retrieval (retrieve()), reading the security context from the per-run AsyncLocalStorage so RBAC is
 * identical to the hand-rolled chat loop.
 */
import { tool } from '@langchain/core/tools';
// zod v4 entrypoint — LangChain v1's tool() accepts it natively (the classic v3 namespace clashes
// with exactOptionalPropertyTypes on _def.description).
import * as z from 'zod/v4';
import { DEFAULT_RETRIEVAL_K, MAX_RETRIEVAL_K } from '../../../config/constants.js';
import { retrieve } from '../../knowledge/retriever.js';
import { requireAgentContext } from '../context.js';

export const ragTool = tool(
  async ({ query, limit }: { query: string; limit: number }) => {
    const { ctx } = requireAgentContext();
    const results = await retrieve(ctx, query, limit);
    if (results.length === 0) return 'No relevant passages found in the knowledge base.';
    return JSON.stringify(
      results.map((r) => ({
        docId: r.docId,
        chunkIndex: r.chunkIndex,
        score: Number(r.score.toFixed(3)),
        content: r.content,
      })),
    );
  },
  {
    name: 'knowledge_search',
    description:
      "Search the Octane knowledge base (pgvector) for relevant passages. Use for policy, product, " +
      "pricing, and how-to questions. Returns passages ranked by relevance, scoped to the caller's " +
      'department access.',
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
);
