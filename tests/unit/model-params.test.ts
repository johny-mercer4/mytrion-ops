import { describe, expect, it, vi } from 'vitest';
import {
  chatOpenAIFields,
  completionParams,
  isReasoningTier,
} from '../../src/modules/llm/modelParams.js';
import { baseModel, computeCost } from '../../src/modules/llm/costTracker.js';

describe('isReasoningTier', () => {
  it('classifies gpt-5-class and o-series models as reasoning tier', () => {
    expect(isReasoningTier('gpt-5.4-mini')).toBe(true);
    expect(isReasoningTier('gpt-5.4-mini-2026-03-17')).toBe(true); // date suffix stripped
    expect(isReasoningTier('gpt-5-nano')).toBe(true);
    expect(isReasoningTier('o3-mini')).toBe(true);
  });

  it('classifies classic chat and Groq models as non-reasoning', () => {
    expect(isReasoningTier('gpt-4o-mini')).toBe(false);
    expect(isReasoningTier('gpt-4o-mini-2024-07-18')).toBe(false);
    expect(isReasoningTier('gpt-4.1-mini')).toBe(false);
    expect(isReasoningTier('openai/gpt-oss-120b')).toBe(false);
  });
});

describe('completionParams (raw SDK)', () => {
  it('uses max_completion_tokens and no temperature for reasoning models', () => {
    expect(completionParams('gpt-5.4-mini-2026-03-17', 4096)).toEqual({
      max_completion_tokens: 4096,
    });
  });

  it('uses max_tokens + temperature 0 for classic models', () => {
    expect(completionParams('gpt-4o-mini', 1024)).toEqual({ max_tokens: 1024, temperature: 0 });
  });
});

describe('chatOpenAIFields (LangChain agent path)', () => {
  it('uses maxCompletionTokens and omits temperature for reasoning models', () => {
    expect(chatOpenAIFields('gpt-5.4-mini-2026-03-17', 4096)).toEqual({
      maxCompletionTokens: 4096,
    });
  });

  it('uses maxTokens + temperature 0 for classic models', () => {
    expect(chatOpenAIFields('gpt-4o-mini-2024-07-18', 4096)).toEqual({
      maxTokens: 4096,
      temperature: 0,
    });
  });
});

describe('baseModel', () => {
  it('strips only a trailing date suffix', () => {
    expect(baseModel('gpt-4o-2024-08-06')).toBe('gpt-4o');
    expect(baseModel('gpt-5.4-mini-2026-03-17')).toBe('gpt-5.4-mini');
    expect(baseModel('openai/gpt-oss-120b')).toBe('openai/gpt-oss-120b');
  });
});

describe('computeCost unknown-model fallback', () => {
  it('charges unknown models at conservative fallback rates instead of zero', () => {
    const usage = { model: 'some-future-model', promptTokens: 1_000_000, completionTokens: 0 };
    const cost = computeCost(usage);
    // gpt-4o input rate — the guard must trip early, never silently stay at $0.
    expect(cost.inputCost).toBeGreaterThan(0);
    expect(cost.totalCost).toBe(cost.inputCost);
  });

  it('still prices known models exactly', () => {
    const cost = computeCost({
      model: 'gpt-4o-mini-2024-07-18',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(cost.inputCost).toBeCloseTo(0.15);
    expect(cost.outputCost).toBeCloseTo(0.6);
  });

  it('warns at most once per unknown model id', async () => {
    const { logger } = await import('../../src/lib/logger.js');
    const warn = vi.spyOn(logger, 'warn');
    computeCost({ model: 'twice-unknown-model', promptTokens: 1, completionTokens: 1 });
    computeCost({ model: 'twice-unknown-model', promptTokens: 1, completionTokens: 1 });
    const hits = warn.mock.calls.filter(
      (c) => (c[0] as { model?: string })?.model === 'twice-unknown-model',
    );
    expect(hits).toHaveLength(1);
    warn.mockRestore();
  });
});
