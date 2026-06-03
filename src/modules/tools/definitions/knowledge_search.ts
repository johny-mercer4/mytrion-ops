import { z } from 'zod';
import { DEFAULT_RETRIEVAL_K, MAX_RETRIEVAL_K } from '../../../config/constants.js';
import { retrieve } from '../../knowledge/retriever.js';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(MAX_RETRIEVAL_K).default(DEFAULT_RETRIEVAL_K),
});

const outputSchema = z.object({
  passages: z.array(
    z.object({
      docId: z.string(),
      chunkIndex: z.number().int(),
      content: z.string(),
      score: z.number(),
    }),
  ),
});

/** REAL tool: tenant/audience-scoped pgvector retrieval over the knowledge base. */
export const knowledgeSearchTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'knowledge.search',
  description:
    'Search the Octane knowledge base for relevant passages. Use for policy, product, pricing, and how-to questions. Returns passages ranked by relevance.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal', 'partner'],
  requiredScopes: [],
  rateLimit: { perMinute: 60 },
  async handler(input, ctx) {
    const results = await retrieve(ctx, input.query, input.limit);
    return {
      passages: results.map((r) => ({
        docId: r.docId,
        chunkIndex: r.chunkIndex,
        content: r.content,
        score: r.score,
      })),
    };
  },
};
