import { beforeEach, describe, expect, it, vi } from 'vitest';

// Distinct create() spies per provider so we can assert which one served the turn. The model router
// is mocked so we can flip the worker provider per test (routerState.workerProvider) without touching
// process env, mirroring what FF_GROQ_ENABLED does in production.
const { groqCreateMock, openaiCreateMock, dispatchMock, retrieveMock, auditMock, routerState } =
  vi.hoisted(() => ({
    groqCreateMock: vi.fn(),
    openaiCreateMock: vi.fn(),
    dispatchMock: vi.fn(),
    retrieveMock: vi.fn(),
    auditMock: vi.fn(async (_ctx: unknown, _opts: { detail?: Record<string, unknown> }) => undefined),
    routerState: { workerProvider: 'groq' as 'groq' | 'openai' },
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
    if (role === 'worker' && routerState.workerProvider === 'groq') {
      return { provider: 'groq', model: 'openai/gpt-oss-120b' };
    }
    return { provider: 'openai', model: 'gpt-4o-mini' };
  },
}));
vi.mock('../../src/modules/knowledge/retriever.js', () => ({ retrieve: retrieveMock }));
vi.mock('../../src/modules/chat/toolDispatcher.js', () => ({ dispatchTool: dispatchMock }));
vi.mock('../../src/repos/conversationRepo.js', () => ({
  conversationRepo: {
    create: vi.fn(async () => ({ id: 'conv_1', title: null })),
    findOwned: vi.fn(async () => ({ id: 'conv_1', title: 'existing' })),
    setTitle: vi.fn(async () => undefined),
    bumpForTurn: vi.fn(async () => undefined),
  },
}));
vi.mock('../../src/modules/chat/messageStore.js', () => ({
  messageStore: {
    appendUser: vi.fn(async () => ({})),
    appendAssistant: vi.fn(async () => ({ id: 'msg_1' })),
    appendToolResult: vi.fn(async () => ({})),
    annotateAssistant: vi.fn(async () => undefined),
    loadHistory: vi.fn(async () => []),
  },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  audit: vi.fn(async () => undefined),
  auditFromContext: auditMock,
}));

import { runChatTurn, streamChatTurn } from '../../src/modules/chat/chatService.js';
import type { SSEStream } from '../../src/modules/chat/streaming.js';
import { makeContext } from '../fixtures/seed.js';

const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

function completion(content: string, toolCalls?: unknown[]) {
  return {
    choices: [{ message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }],
    usage,
  };
}

// --- Streaming helpers: create(stream:true) resolves to an async-iterable of chunks. ---
function tokenChunk(text: string) {
  return { choices: [{ delta: { content: text } }] };
}
function usageChunk() {
  return { choices: [{ delta: {} }], usage };
}
function streamOf(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}
/** A stream that yields chunks then throws mid-iteration (connection reset / 5xx after first chunk). */
function streamThenThrow(chunks: unknown[], err: Error): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
      throw err;
    },
  };
}

interface RecordingSSE extends SSEStream {
  events: Array<{ event: string; data: unknown }>;
  tokens(): string;
}
function fakeSSE(): RecordingSSE {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    events,
    send: (event: string, data: unknown) => void events.push({ event, data }),
    comment: () => undefined,
    close: () => undefined,
    tokens: () =>
      events
        .filter((e) => e.event === 'token')
        .map((e) => (e.data as { text: string }).text)
        .join(''),
  };
}

function lastAuditDetail() {
  const calls = auditMock.mock.calls;
  return calls[calls.length - 1]?.[1]?.detail as { provider: string; fellBack: boolean; streamed?: boolean };
}

beforeEach(() => {
  groqCreateMock.mockReset();
  openaiCreateMock.mockReset();
  dispatchMock.mockReset();
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  retrieveMock.mockReset();
  retrieveMock.mockResolvedValue([]);
  routerState.workerProvider = 'groq';
});

describe('runChatTurn provider routing (non-streaming)', () => {
  it('serves the turn from Groq when the worker resolves to Groq', async () => {
    groqCreateMock.mockResolvedValueOnce(completion('From Groq'));

    const res = await runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }));

    expect(res.message).toBe('From Groq');
    expect(groqCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).not.toHaveBeenCalled();
    expect(groqCreateMock.mock.calls[0]?.[0]?.model).toBe('openai/gpt-oss-120b');
    expect(lastAuditDetail()).toMatchObject({ provider: 'groq', fellBack: false });
  });

  it('falls back to OpenAI for the rest of the turn when Groq errors', async () => {
    groqCreateMock.mockRejectedValueOnce(new Error('groq 503'));
    openaiCreateMock.mockResolvedValueOnce(completion('Recovered on OpenAI'));

    const res = await runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }));

    expect(res.message).toBe('Recovered on OpenAI');
    expect(groqCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock.mock.calls[0]?.[0]?.model).toBe('gpt-4o-mini');
    expect(lastAuditDetail()).toMatchObject({ provider: 'openai', fellBack: true });
  });

  it('stays on OpenAI for ALL later iterations after a first-iteration Groq failure', async () => {
    // iter 1: Groq fails → fallback OpenAI returns a tool call. iter 2 must also be OpenAI (sticky turn).
    groqCreateMock.mockRejectedValueOnce(new Error('groq 503'));
    openaiCreateMock
      .mockResolvedValueOnce(
        completion('', [
          { id: 'call_1', type: 'function', function: { name: 'knowledge__search', arguments: '{"query":"x"}' } },
        ]),
      )
      .mockResolvedValueOnce(completion('Done on OpenAI'));
    dispatchMock.mockResolvedValueOnce({ passages: [] });

    const res = await runChatTurn(undefined, 'look it up', makeContext({ role: 'ops' }));

    expect(res.message).toBe('Done on OpenAI');
    expect(res.iterations).toBe(2);
    expect(groqCreateMock).toHaveBeenCalledTimes(1); // never re-attempted
    expect(openaiCreateMock).toHaveBeenCalledTimes(2);
    expect(lastAuditDetail()).toMatchObject({ provider: 'openai', fellBack: true });
  });

  it('flag-off parity: worker on OpenAI never touches Groq, and an OpenAI error is not "fallback"', async () => {
    routerState.workerProvider = 'openai';
    openaiCreateMock.mockResolvedValueOnce(completion('Baseline'));

    const res = await runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }));

    expect(res.message).toBe('Baseline');
    expect(groqCreateMock).not.toHaveBeenCalled();
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    expect(lastAuditDetail()).toMatchObject({ provider: 'openai', fellBack: false });
  });

  it('flag-off: an OpenAI failure propagates (no provider fallback loop)', async () => {
    routerState.workerProvider = 'openai';
    openaiCreateMock.mockRejectedValueOnce(new Error('openai down'));

    await expect(runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }))).rejects.toThrow('openai down');
    expect(groqCreateMock).not.toHaveBeenCalled();
  });
});

describe('streamChatTurn provider routing (SSE)', () => {
  it('streams the worker turn from Groq', async () => {
    groqCreateMock.mockResolvedValueOnce(streamOf([tokenChunk('Hi'), tokenChunk(' there'), usageChunk()]));
    const sse = fakeSSE();

    const res = await streamChatTurn(undefined, 'hi', makeContext({ role: 'ops' }), sse);

    expect(res.message).toBe('Hi there');
    expect(sse.tokens()).toBe('Hi there');
    expect(groqCreateMock).toHaveBeenCalledTimes(1);
    expect(groqCreateMock.mock.calls[0]?.[0]?.model).toBe('openai/gpt-oss-120b');
    expect(openaiCreateMock).not.toHaveBeenCalled();
    expect(lastAuditDetail()).toMatchObject({ provider: 'groq', fellBack: false, streamed: true });
    expect(sse.events.some((e) => e.event === 'done')).toBe(true);
  });

  it('falls back to OpenAI when the Groq stream fails to OPEN', async () => {
    groqCreateMock.mockRejectedValueOnce(new Error('groq open 503'));
    openaiCreateMock.mockResolvedValueOnce(streamOf([tokenChunk('Hello'), tokenChunk(' OpenAI'), usageChunk()]));
    const sse = fakeSSE();

    const res = await streamChatTurn(undefined, 'hi', makeContext({ role: 'ops' }), sse);

    expect(res.message).toBe('Hello OpenAI');
    expect(sse.tokens()).toBe('Hello OpenAI');
    expect(groqCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock.mock.calls[0]?.[0]?.model).toBe('gpt-4o-mini');
    expect(lastAuditDetail()).toMatchObject({ provider: 'openai', fellBack: true, streamed: true });
  });

  it('falls back to OpenAI when the Groq stream fails BEFORE the first token', async () => {
    groqCreateMock.mockResolvedValueOnce(streamThenThrow([], new Error('reset pre-token')));
    openaiCreateMock.mockResolvedValueOnce(streamOf([tokenChunk('Recovered'), usageChunk()]));
    const sse = fakeSSE();

    const res = await streamChatTurn(undefined, 'hi', makeContext({ role: 'ops' }), sse);

    expect(res.message).toBe('Recovered');
    expect(sse.tokens()).toBe('Recovered');
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    expect(lastAuditDetail()).toMatchObject({ provider: 'openai', fellBack: true });
  });

  it('does NOT fall back (would duplicate output) when Groq fails AFTER a token was streamed', async () => {
    groqCreateMock.mockResolvedValueOnce(streamThenThrow([tokenChunk('partial')], new Error('reset mid-stream')));
    const sse = fakeSSE();

    await expect(streamChatTurn(undefined, 'hi', makeContext({ role: 'ops' }), sse)).rejects.toThrow(
      'reset mid-stream',
    );
    // The partial token reached the client exactly once; no OpenAI re-run that would duplicate it.
    expect(sse.tokens()).toBe('partial');
    expect(openaiCreateMock).not.toHaveBeenCalled();
  });
});
