/**
 * Cached prompt tokens must be billed at the cached rate.
 *
 * Measured on a live turn: the provider served 10,880 of 11,225 prompt tokens from its prefix cache
 * (90–97% from the second call of a turn onward), but `runTracker` read cache counts from
 * `llmOutput.tokenUsage` — which carries only promptTokens/completionTokens/totalTokens — so `cached`
 * was always 0. Every turn recorded a 0% hit rate and every cached token was billed at the full input
 * rate.
 */
import { describe, expect, it } from 'vitest';
import { computeCost } from '../../src/modules/llm/costTracker.js';
import { MODEL_PRICING } from '../../src/config/constants.js';

const MODEL = 'gpt-5.4-mini-2026-03-17';

describe('computeCost — cached prompt tokens', () => {
  it('charges cached tokens at the cached rate, not the input rate', () => {
    const pricing = MODEL_PRICING[MODEL];
    expect(pricing?.cachedInput, 'the model needs a cached rate to discount').toBeDefined();

    const full = computeCost({ model: MODEL, promptTokens: 10_000, completionTokens: 100 });
    const cached = computeCost({
      model: MODEL,
      promptTokens: 10_000,
      completionTokens: 100,
      cachedPromptTokens: 9_000,
    });
    expect(cached.totalCost).toBeLessThan(full.totalCost);

    // 1,000 fresh + 9,000 cached, priced explicitly.
    const expectedInput =
      (1_000 / 1_000_000) * (pricing?.input ?? 0) + (9_000 / 1_000_000) * (pricing?.cachedInput ?? 0);
    expect(cached.inputCost).toBeCloseTo(expectedInput, 10);
  });

  it('is identical to the old behaviour when nothing was cached', () => {
    const a = computeCost({ model: MODEL, promptTokens: 5_000, completionTokens: 50 });
    const b = computeCost({
      model: MODEL,
      promptTokens: 5_000,
      completionTokens: 50,
      cachedPromptTokens: 0,
    });
    expect(b.totalCost).toBe(a.totalCost);
  });

  it('never lets cached exceed prompt tokens, so cost cannot go negative', () => {
    const out = computeCost({
      model: MODEL,
      promptTokens: 1_000,
      completionTokens: 10,
      cachedPromptTokens: 99_999,
    });
    expect(out.inputCost).toBeGreaterThanOrEqual(0);
    const allCached = (1_000 / 1_000_000) * (MODEL_PRICING[MODEL]?.cachedInput ?? 0);
    expect(out.inputCost).toBeCloseTo(allCached, 10);
  });

  it('ignores a negative cached count rather than inflating cost', () => {
    const out = computeCost({
      model: MODEL,
      promptTokens: 1_000,
      completionTokens: 10,
      cachedPromptTokens: -500,
    });
    const none = computeCost({ model: MODEL, promptTokens: 1_000, completionTokens: 10 });
    expect(out.inputCost).toBeCloseTo(none.inputCost, 10);
  });

  it('falls back to the full input rate for a model with no cached price (never under-charges)', () => {
    // An unpriced model must not be discounted, or AGENT_MAX_COST_USD would trip too late.
    const priced = computeCost({
      model: 'text-embedding-3-small',
      promptTokens: 1_000,
      completionTokens: 0,
      cachedPromptTokens: 1_000,
    });
    const undiscounted = computeCost({
      model: 'text-embedding-3-small',
      promptTokens: 1_000,
      completionTokens: 0,
    });
    expect(priced.inputCost).toBeCloseTo(undiscounted.inputCost, 10);
  });
});
