import { afterEach, describe, expect, it, vi } from 'vitest';

// The router reads env.FF_GROQ_ENABLED and the GROQ_MODEL_WORKER id; mock env so we can flip the flag
// without touching the process environment. `models` comes from the real openaiClient (no key needed).
const { envMock } = vi.hoisted(() => ({
  envMock: {
    FF_GROQ_ENABLED: false,
    GROQ_MODEL_WORKER: 'openai/gpt-oss-120b',
  },
}));

vi.mock('../../src/config/env.js', () => ({ env: envMock }));
vi.mock('../../src/modules/llm/openaiClient.js', () => ({
  models: { default: 'gpt-4o-mini', reasoning: 'gpt-5.4-mini', embedding: 'text-embedding-3-small' },
}));

import { resolveModel } from '../../src/modules/llm/modelRouter.js';

afterEach(() => {
  envMock.FF_GROQ_ENABLED = false;
});

describe('resolveModel', () => {
  it('routes the worker role to OpenAI when Groq is disabled', () => {
    envMock.FF_GROQ_ENABLED = false;
    expect(resolveModel('worker')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('routes the worker role to Groq when enabled', () => {
    envMock.FF_GROQ_ENABLED = true;
    expect(resolveModel('worker')).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
  });

  it('keeps answer/reasoning/embedding on OpenAI even when Groq is enabled', () => {
    envMock.FF_GROQ_ENABLED = true;
    expect(resolveModel('answer')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(resolveModel('reasoning')).toEqual({ provider: 'openai', model: 'gpt-5.4-mini' });
    expect(resolveModel('embedding')).toEqual({ provider: 'openai', model: 'text-embedding-3-small' });
  });

  it('honors an explicit model override: a "/" id is treated as Groq', () => {
    expect(resolveModel('worker', { model: 'openai/gpt-oss-20b' })).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
    });
  });

  it('honors an explicit model override: a plain id is treated as OpenAI', () => {
    expect(resolveModel('worker', { model: 'gpt-4o' })).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });
});
