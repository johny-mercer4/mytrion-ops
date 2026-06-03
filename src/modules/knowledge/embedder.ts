import { EMBEDDING_DIMENSIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { getOpenAI } from '../llm/openaiClient.js';

/**
 * Embed a batch of texts with OpenAI text-embedding-3-small (1536-dim). Results are
 * returned in the same order as the input (we sort by the API's `index`).
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await getOpenAI().embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: texts,
  });
  const ordered = [...res.data].sort((a, b) => a.index - b.index);
  return ordered.map((d) => {
    if (d.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new AppError(
        `Unexpected embedding dimension ${d.embedding.length} (expected ${EMBEDDING_DIMENSIONS})`,
        { code: 'EMBEDDING_DIM_MISMATCH', statusCode: 502 },
      );
    }
    return d.embedding;
  });
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new AppError('Embedding returned no vector', { statusCode: 502 });
  return vector;
}
