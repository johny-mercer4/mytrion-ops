import { afterEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    FF_RAG_MODEL_POLICY: true,
    OPENAI_TIMEOUT_MS: 30_000,
    LLM_MAX_OUTPUT_TOKENS: 1_000,
  },
}));

vi.mock('../../src/config/env.js', () => ({ env: envMock }));
vi.mock('../../src/modules/llm/openaiClient.js', () => ({
  models: {
    default: 'gpt-5.4-nano',
    nano: 'gpt-5.4-nano',
    grounded: 'gpt-5.4-mini',
    reasoning: 'gpt-5.4-mini',
    hard: 'gpt-5.4',
    embedding: 'text-embedding-3-small',
  },
}));

import { resolveModel, resolveModelPolicy } from '../../src/modules/llm/modelRouter.js';

afterEach(() => {
  envMock.FF_RAG_MODEL_POLICY = true;
});

describe('resolveModel', () => {
  it('routes each role to its tier', () => {
    expect(resolveModel('worker')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
    expect(resolveModel('router')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
    expect(resolveModel('grader')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
    expect(resolveModel('casual')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
    expect(resolveModel('answer')).toEqual({ provider: 'openai', model: 'gpt-5.4-mini' });
    expect(resolveModel('embedding')).toEqual({ provider: 'openai', model: 'text-embedding-3-small' });
  });

  /**
   * The whole point of an escalation tier. `hard` defaulted to the same id as `grounded` until
   * 2026-08-12, which made every "escalate to reasoning" path resolve to the model that had just
   * failed — a no-op dressed as a fallback.
   */
  it('escalates to a model that is genuinely different from the answer tier', () => {
    const answer = resolveModel('answer');
    const reasoning = resolveModel('reasoning');
    expect(reasoning).toEqual({ provider: 'openai', model: 'gpt-5.4' });
    expect(reasoning.model).not.toBe(answer.model);
  });

  it('rolls every chat role back to one control model with a single flag', () => {
    envMock.FF_RAG_MODEL_POLICY = false;
    expect(resolveModel('worker')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
    expect(resolveModel('answer')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
    expect(resolveModel('casual')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
    // Escalation is deliberately NOT part of the rollback — it must stay a real step up.
    expect(resolveModel('reasoning')).toEqual({ provider: 'openai', model: 'gpt-5.4' });
  });

  it('honors an explicit model override', () => {
    expect(resolveModel('worker', { model: 'gpt-4o' })).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  /**
   * Groq and GLM were removed 2026-08-12. A slash-bearing id used to be routed to Groq; it must now
   * resolve to OpenAI like any other override rather than silently selecting a provider that is
   * gone. `evidenceAllowed` stays true because OpenAI is the only vetted provider — a future
   * provider has to re-establish that before it can carry internal evidence.
   */
  it('never resolves a non-OpenAI provider, whatever the override looks like', () => {
    for (const model of ['openai/gpt-oss-20b', 'glm-4-flash', 'llama-3.3-70b-versatile']) {
      const policy = resolveModelPolicy('worker', { model });
      expect(policy.provider).toBe('openai');
      expect(policy.model).toBe(model);
      expect(policy.evidenceAllowed).toBe(true);
      expect(policy).not.toHaveProperty('fallback');
    }
  });

  it('keeps evidence-bearing roles on the vetted provider', () => {
    const policy = resolveModelPolicy('answer', { evidenceBearing: true });
    expect(policy.provider).toBe('openai');
    expect(policy.evidenceAllowed).toBe(true);
  });
});
