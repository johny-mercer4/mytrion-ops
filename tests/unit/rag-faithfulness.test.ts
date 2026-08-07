import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env.js')>();
  return { ...actual, env: { ...actual.env, FF_RAG_CLAIM_VERIFY: true } };
});

import { verifyAnswerFaithfulness } from '../../src/modules/knowledge/agentic/faithfulness.js';

const evidence = [{ marker: 'S1', docId: 'doc-1', content: 'The verified source supports this answer.' }];

describe('practical Self-RAG faithfulness verifier', () => {
  it('keeps a sufficiently cited routine answer', async () => {
    const result = await verifyAnswerFaithfulness(
      'The verified source supports this operational answer [S1].',
      evidence,
    );
    expect(result).toMatchObject({ repaired: false, abstained: false, coverage: 1 });
  });

  it('removes an unsupported claim in one bounded repair pass', async () => {
    const result = await verifyAnswerFaithfulness(
      'The verified source supports this operational answer [S1]. This extra assertion has no supporting citation.',
      evidence,
    );
    expect(result.repaired).toBe(true);
    expect(result.text).not.toContain('extra assertion');
    expect(result.text).toContain('omitted additional details');
  });

  it('returns an honest abstention when no factual claim is supported', async () => {
    const result = await verifyAnswerFaithfulness(
      'This authoritative-looking assertion has no evidence marker.',
      evidence,
    );
    expect(result).toMatchObject({ repaired: true, abstained: true });
    expect(result.text).toMatch(/could not verify/i);
  });
});
