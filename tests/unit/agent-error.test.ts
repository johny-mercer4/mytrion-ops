import { describe, expect, it } from 'vitest';
import { isRateLimitError, presentAgentError } from '../../src/modules/agents/agentError.js';

describe('agent error presentation', () => {
  it.each([
    '400 模型不存在，请检查模型代码。',
    'The model code does not exist',
    'invalid_model requested',
  ])('hides provider-specific model errors: %s', (message) => {
    const presented = presentAgentError(message, false);
    expect(presented).toMatch(/configured AI model is currently unavailable/i);
    expect(presented).not.toContain(message);
  });

  it('keeps the bounded-run guidance for budget failures', () => {
    expect(presentAgentError('wall-clock limit', true)).toMatch(/stop early.*narrow/i);
  });

  /**
   * Measured 2026-08-12: ~28,700 input tokens per turn against a 200,000 TPM org limit is ~7 turns
   * per minute for the whole org, and one developer benching tripped it three times in a day. A 429
   * used to fall through to "The AI service failed to complete this request", which reads as broken
   * and tells the user to retry immediately — the one action that makes contention worse.
   */
  it.each([
    "429 Rate limit reached for gpt-5.4-mini in organization org-X on tokens per min (TPM): Limit 200000, Used 196383, Requested 7228. Please try again in 1.083s.",
    'Too Many Requests',
    'requests per min (RPM) exceeded',
  ])('explains provider throttling as capacity, not breakage: %s', (message) => {
    const presented = presentAgentError(message, false);
    expect(presented).toMatch(/at capacity/i);
    expect(presented).toMatch(/wait a few seconds/i);
    expect(presented).not.toMatch(/failed to complete/i);
    // Never leak the org id, the limit, or the raw provider text.
    expect(presented).not.toContain('org-X');
    expect(presented).not.toContain('200000');
    expect(isRateLimitError(message)).toBe(true);
  });

  /**
   * Ordering matters: a rate-limit body names the model, so a model-unavailable check running first
   * would send the user to an administrator for something that clears itself in seconds.
   */
  it('treats a model-naming rate limit as capacity, not an unavailable model', () => {
    const message = '429 Rate limit reached for model gpt-5.4-mini: tokens per min (TPM)';
    expect(presentAgentError(message, false)).toMatch(/at capacity/i);
  });

  it('does not classify ordinary failures as throttling', () => {
    expect(isRateLimitError('upstream host failed')).toBe(false);
    expect(isRateLimitError('invalid_model requested')).toBe(false);
  });

  it('does not expose arbitrary internal errors', () => {
    const raw = 'secret upstream host failed with credential abc';
    const presented = presentAgentError(raw, false);
    expect(presented).toBe('The AI service failed to complete this request. Please retry.');
    expect(presented).not.toContain(raw);
  });
});
