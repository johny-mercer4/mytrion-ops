import { describe, expect, it } from 'vitest';
import { presentAgentError } from '../../src/modules/agents/agentError.js';

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

  it('does not expose arbitrary internal errors', () => {
    const raw = 'secret upstream host failed with credential abc';
    const presented = presentAgentError(raw, false);
    expect(presented).toBe('The AI service failed to complete this request. Please retry.');
    expect(presented).not.toContain(raw);
  });
});
