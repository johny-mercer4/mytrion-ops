import { EMBEDDING_DIMENSIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { getOpenAI } from '../llm/openaiClient.js';

/**
 * Embed a batch of texts with OpenAI text-embedding-3-small (1536-dim). Inputs are sent in
 * slices of EMBED_BATCH_SIZE — a large document must not exceed the per-request input limit
 * and fail the whole ingest. Results are returned in input order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let start = 0; start < texts.length; start += env.EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + env.EMBED_BATCH_SIZE);
    const res = await getOpenAI().embeddings.create({
      model: env.OPEN_AI_EMBEDDING_SMALL,
      input: batch,
    });
    const ordered = [...res.data].sort((a, b) => a.index - b.index);
    for (const d of ordered) {
      if (d.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new AppError(
          `Unexpected embedding dimension ${d.embedding.length} (expected ${EMBEDDING_DIMENSIONS})`,
          { code: 'EMBEDDING_DIM_MISMATCH', statusCode: 502 },
        );
      }
      out.push(d.embedding);
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new AppError('Embedding returned no vector', { statusCode: 502 });
  return vector;
}
