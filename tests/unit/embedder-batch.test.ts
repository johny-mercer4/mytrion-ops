import { afterEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { env } from '../../src/config/env.js';
import { embedTexts } from '../../src/modules/knowledge/embedder.js';
import { setOpenAIClient } from '../../src/modules/llm/openaiClient.js';

const DIM = 1536;
const vec = (fill: number) => new Array<number>(DIM).fill(fill);

function stubClient(create: ReturnType<typeof vi.fn>): OpenAI {
  return { embeddings: { create } } as unknown as OpenAI;
}

const originalBatch = env.EMBED_BATCH_SIZE;

afterEach(() => {
  env.EMBED_BATCH_SIZE = originalBatch;
  vi.restoreAllMocks();
});

describe('embedTexts batching', () => {
  it('slices large inputs into EMBED_BATCH_SIZE requests, preserving order', async () => {
    env.EMBED_BATCH_SIZE = 2;
    const create = vi.fn().mockImplementation(({ input }: { input: string[] }) =>
      Promise.resolve({
        // Return out of order within the batch to prove index-sorting works per batch.
        data: input
          .map((text, i) => ({ index: i, embedding: vec(Number(text)) }))
          .reverse(),
      }),
    );
    setOpenAIClient(stubClient(create));

    const out = await embedTexts(['0', '1', '2', '3', '4']);
    expect(create).toHaveBeenCalledTimes(3); // 2 + 2 + 1
    expect(create.mock.calls.map((c) => (c[0] as { input: string[] }).input)).toEqual([
      ['0', '1'],
      ['2', '3'],
      ['4'],
    ]);
    expect(out.map((v) => v[0])).toEqual([0, 1, 2, 3, 4]);
  });

  it('sends a single request when under the batch size', async () => {
    env.EMBED_BATCH_SIZE = 128;
    const create = vi.fn().mockResolvedValue({
      data: [{ index: 0, embedding: vec(1) }],
    });
    setOpenAIClient(stubClient(create));
    await embedTexts(['only']);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects on a dimension mismatch', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [{ index: 0, embedding: [1, 2, 3] }],
    });
    setOpenAIClient(stubClient(create));
    await expect(embedTexts(['x'])).rejects.toThrow(/dimension/i);
  });
});
