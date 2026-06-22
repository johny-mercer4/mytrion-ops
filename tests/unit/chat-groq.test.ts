import { beforeEach, describe, expect, it, vi } from 'vitest';

// Distinct create() spies per provider so we can assert which one served the turn. The model router
// is mocked to force the worker role onto Groq (independent of FF_GROQ_ENABLED / process env), which
// is what the chat loop does when the flag is on.
const { groqCreateMock, openaiCreateMock, dispatchMock, retrieveMock, auditMock } = vi.hoisted(() => ({
  groqCreateMock: vi.fn(),
  openaiCreateMock: vi.fn(),
  dispatchMock: vi.fn(),
  retrieveMock: vi.fn(),
  auditMock: vi.fn(async (_ctx: unknown, _opts: { detail?: Record<string, unknown> }) => undefined),
}));

vi.mock('../../src/modules/llm/openaiClient.js', () => {
  const groqStub = { chat: { completions: { create: groqCreateMock } } };
  const openaiStub = { chat: { completions: { create: openaiCreateMock } } };
  return {
    getOpenAI: () => openaiStub,
    getGroq: () => groqStub,
    getClient: (provider: 'openai' | 'groq') => (provider === 'groq' ? groqStub : openaiStub),
    setOpenAIClient: vi.fn(),
    setGroqClient: vi.fn(),
    models: { default: 'gpt-4o-mini', reasoning: 'gpt-5.4-mini', embedding: 'text-embedding-3-small' },
  };
});
vi.mock('../../src/modules/llm/modelRouter.js', () => ({
  resolveModel: (role: string, opts: { model?: string } = {}) => {
    if (opts.model) return { provider: opts.model.includes('/') ? 'groq' : 'openai', model: opts.model };
    if (role === 'worker') return { provider: 'groq', model: 'openai/gpt-oss-120b' };
    return { provider: 'openai', model: 'gpt-4o-mini' };
  },
}));
vi.mock('../../src/modules/knowledge/retriever.js', () => ({ retrieve: retrieveMock }));
vi.mock('../../src/modules/chat/toolDispatcher.js', () => ({ dispatchTool: dispatchMock }));
vi.mock('../../src/repos/conversationRepo.js', () => ({
  conversationRepo: {
    create: vi.fn(async () => ({ id: 'conv_1' })),
    findOwned: vi.fn(async () => ({ id: 'conv_1' })),
    touch: vi.fn(async () => undefined),
  },
}));
vi.mock('../../src/modules/chat/messageStore.js', () => ({
  messageStore: {
    appendUser: vi.fn(async () => ({})),
    appendAssistant: vi.fn(async () => ({})),
    appendToolResult: vi.fn(async () => ({})),
    loadHistory: vi.fn(async () => []),
  },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  audit: vi.fn(async () => undefined),
  auditFromContext: auditMock,
}));

import { runChatTurn } from '../../src/modules/chat/chatService.js';
import { makeContext } from '../fixtures/seed.js';

function completion(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

beforeEach(() => {
  groqCreateMock.mockReset();
  openaiCreateMock.mockReset();
  dispatchMock.mockReset();
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  retrieveMock.mockReset();
  retrieveMock.mockResolvedValue([]);
});

describe('runChatTurn provider routing', () => {
  it('serves the turn from Groq when the worker resolves to Groq', async () => {
    groqCreateMock.mockResolvedValueOnce(completion('From Groq'));

    const res = await runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }));

    expect(res.message).toBe('From Groq');
    expect(groqCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).not.toHaveBeenCalled();
    // The completion was requested with the Groq worker model id.
    expect(groqCreateMock.mock.calls[0]?.[0]?.model).toBe('openai/gpt-oss-120b');
    const detail = auditMock.mock.calls[0]?.[1]?.detail as { provider: string; fellBack: boolean };
    expect(detail).toMatchObject({ provider: 'groq', fellBack: false });
  });

  it('falls back to OpenAI for the rest of the turn when Groq errors', async () => {
    groqCreateMock.mockRejectedValueOnce(new Error('groq 503'));
    openaiCreateMock.mockResolvedValueOnce(completion('Recovered on OpenAI'));

    const res = await runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }));

    expect(res.message).toBe('Recovered on OpenAI');
    expect(groqCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    // Fallback re-issues against the default OpenAI model and records the fallback in the audit detail.
    expect(openaiCreateMock.mock.calls[0]?.[0]?.model).toBe('gpt-4o-mini');
    const detail = auditMock.mock.calls[0]?.[1]?.detail as { provider: string; fellBack: boolean };
    expect(detail).toMatchObject({ provider: 'openai', fellBack: true });
  });
});
