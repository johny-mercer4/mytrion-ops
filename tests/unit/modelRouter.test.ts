import { afterEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: {
    FF_GROQ_ENABLED: false,
    FF_RAG_MODEL_POLICY: true,
    GROQ_MODEL_WORKER: 'openai/gpt-oss-120b',
    OPENAI_TIMEOUT_MS: 30_000,
    LLM_MAX_OUTPUT_TOKENS: 1_000,
  },
}));

vi.mock('../../src/config/env.js', () => ({ env: envMock }));
vi.mock('../../src/modules/llm/openaiClient.js', () => ({
  models: {
    default: 'gpt-4o-mini',
    nano: 'gpt-5.4-nano',
    grounded: 'gpt-5.4-mini',
    reasoning: 'gpt-5.4-mini',
    hard: 'gpt-5.6-terra',
    embedding: 'text-embedding-3-small',
  },
}));

import { resolveModel } from '../../src/modules/llm/modelRouter.js';

afterEach(() => {
  envMock.FF_GROQ_ENABLED = false;
  envMock.FF_RAG_MODEL_POLICY = true;
});

describe('resolveModel', () => {
  it('routes the worker role to OpenAI when Groq is disabled', () => {
    envMock.FF_GROQ_ENABLED = false;
    expect(resolveModel('worker')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
  });

  it('rolls all chat roles back to the GPT-4o-mini control with one flag', () => {
    envMock.FF_RAG_MODEL_POLICY = false;
    expect(resolveModel('worker')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(resolveModel('answer')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(resolveModel('casual')).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('keeps live worker traffic on OpenAI even when Groq is enabled', () => {
    envMock.FF_GROQ_ENABLED = true;
    expect(resolveModel('worker')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
  });

  it('permits Groq only for a sanitized, evidence-free benchmark case', () => {
    envMock.FF_GROQ_ENABLED = true;
    expect(resolveModel('worker', { sanitizedBenchmark: true })).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });
  });

  it('keeps evidence-bearing roles on OpenAI even when Groq is enabled', () => {
    envMock.FF_GROQ_ENABLED = true;
    expect(resolveModel('answer')).toEqual({ provider: 'openai', model: 'gpt-5.4-mini' });
    expect(resolveModel('reasoning')).toEqual({ provider: 'openai', model: 'gpt-5.6-terra' });
    expect(resolveModel('embedding')).toEqual({ provider: 'openai', model: 'text-embedding-3-small' });
    expect(resolveModel('casual')).toEqual({ provider: 'openai', model: 'gpt-5.4-nano' });
  });

  it('permits an explicit Groq override only for sanitized benchmark input', () => {
    expect(resolveModel('worker', { model: 'openai/gpt-oss-20b', sanitizedBenchmark: true })).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
    });
  });

  it('rejects an explicit Groq override for a live request without evidence', () => {
    expect(resolveModel('worker', { model: 'openai/gpt-oss-20b' })).toEqual({
      provider: 'openai',
      model: 'gpt-5.4-nano',
    });
  });

  it('honors an explicit model override: a plain id is treated as OpenAI', () => {
    expect(resolveModel('worker', { model: 'gpt-4o' })).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('rejects an explicit Groq override when internal evidence is present', () => {
    expect(resolveModel('answer', { model: 'openai/gpt-oss-20b', evidenceBearing: true })).toEqual({
      provider: 'openai',
      model: 'gpt-5.4-mini',
    });
  });
});
