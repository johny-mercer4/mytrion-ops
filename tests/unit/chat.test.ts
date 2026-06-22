import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMock, dispatchMock, retrieveMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  dispatchMock: vi.fn(),
  retrieveMock: vi.fn(),
}));

vi.mock('../../src/modules/llm/openaiClient.js', () => {
  const stub = { chat: { completions: { create: createMock } } };
  return {
    getOpenAI: () => stub,
    getGroq: () => stub,
    getClient: () => stub,
    setOpenAIClient: vi.fn(),
    setGroqClient: vi.fn(),
    models: { default: 'gpt-4o-mini', reasoning: 'gpt-4o', embedding: 'text-embedding-3-small' },
  };
});
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
  auditFromContext: vi.fn(async () => undefined),
}));

import { runChatTurn } from '../../src/modules/chat/chatService.js';
import { makeContext } from '../fixtures/seed.js';

function completion(content: string, toolCalls?: unknown[]) {
  return {
    choices: [
      { message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

beforeEach(() => {
  createMock.mockReset();
  dispatchMock.mockReset();
  retrieveMock.mockReset();
  retrieveMock.mockResolvedValue([]); // default: no grounded passages
});

describe('runChatTurn', () => {
  it('returns the assistant answer for a no-tool turn', async () => {
    createMock.mockResolvedValueOnce(completion('Hello from Octane'));
    const res = await runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }));
    expect(res.message).toBe('Hello from Octane');
    expect(res.iterations).toBe(1);
    expect(res.toolCalls).toEqual([]);
    expect(res.usage.promptTokens).toBe(10);
    expect(res.ragPassages).toBe(0);
  });

  it('injects RBAC-scoped RAG passages as grounding context', async () => {
    retrieveMock.mockResolvedValueOnce([
      { id: 'c1', docId: 'doc_policy', chunkIndex: 0, content: 'Fuel cards expire after 36 months.', score: 0.91 },
    ]);
    createMock.mockResolvedValueOnce(completion('Grounded answer'));

    const res = await runChatTurn(undefined, 'when do cards expire?', makeContext({ role: 'ops', departments: ['sales'] }));

    expect(res.ragPassages).toBe(1);
    // The retriever was called with the department-scoped context (RBAC enforced downstream).
    expect(retrieveMock.mock.calls[0]?.[0]).toMatchObject({ departments: ['sales'] });
    // A system message carrying the retrieved passage was sent to the model.
    const sentMessages = createMock.mock.calls[0]?.[0]?.messages as Array<{ role: string; content: string }>;
    const grounding = sentMessages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    expect(grounding).toContain('Fuel cards expire after 36 months.');
  });

  it('dispatches tool calls (mapping names back) then returns the final answer', async () => {
    createMock
      .mockResolvedValueOnce(
        completion('', [
          { id: 'call_1', type: 'function', function: { name: 'knowledge__search', arguments: '{"query":"x"}' } },
        ]),
      )
      .mockResolvedValueOnce(completion('Final answer'));
    dispatchMock.mockResolvedValueOnce({ passages: [] });

    const res = await runChatTurn('conv_1', 'look it up', makeContext({ role: 'ops' }));

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0]?.[0]).toBe('knowledge.search');
    expect(res.toolCalls).toEqual([{ name: 'knowledge.search', status: 'ok' }]);
    expect(res.message).toBe('Final answer');
    expect(res.iterations).toBe(2);
  });

  it('parses tool arguments that a Groq model wrapped in fences / function tags', async () => {
    // gpt-oss/Llama sometimes emit `<|python_tag|>`, `<function>…</function>`, or ```json fences
    // around the JSON. The parse-on-failure fallback should unwrap those so the call still dispatches.
    const wrapped = '<|python_tag|><function=knowledge__search>```json\n{"query":"expiry"}\n```</function>';
    createMock
      .mockResolvedValueOnce(
        completion('', [
          { id: 'call_1', type: 'function', function: { name: 'knowledge__search', arguments: wrapped } },
        ]),
      )
      .mockResolvedValueOnce(completion('Grounded'));
    dispatchMock.mockResolvedValueOnce({ passages: [] });

    const res = await runChatTurn('conv_1', 'look it up', makeContext({ role: 'ops' }));

    expect(dispatchMock.mock.calls[0]?.[0]).toBe('knowledge.search');
    expect(dispatchMock.mock.calls[0]?.[1]).toEqual({ query: 'expiry' });
    expect(res.toolCalls).toEqual([{ name: 'knowledge.search', status: 'ok' }]);
  });

  it('does NOT mangle valid JSON whose values contain backticks / tags (parse-first, no false positives)', async () => {
    // Regression: the unwrapper must never run on already-valid JSON, or it would corrupt argument
    // values that legitimately contain ```fences```, <function> tokens, or <|python_tag|> literals.
    const args = JSON.stringify({
      query: 'how do I write a ```json``` block and a <function>foo</function> tag?',
      note: 'the <|python_tag|> marker stays intact',
    });
    createMock
      .mockResolvedValueOnce(
        completion('', [
          { id: 'call_1', type: 'function', function: { name: 'knowledge__search', arguments: args } },
        ]),
      )
      .mockResolvedValueOnce(completion('Answer'));
    dispatchMock.mockResolvedValueOnce({ passages: [] });

    const res = await runChatTurn('conv_1', 'q', makeContext({ role: 'ops' }));

    // Arguments survive byte-for-byte; the call dispatches (no spurious "invalid JSON" error).
    expect(dispatchMock.mock.calls[0]?.[1]).toEqual(JSON.parse(args));
    expect(res.toolCalls).toEqual([{ name: 'knowledge.search', status: 'ok' }]);
  });

  it('reports unparseable tool arguments as an error without dispatching', async () => {
    createMock
      .mockResolvedValueOnce(
        completion('', [
          { id: 'call_1', type: 'function', function: { name: 'knowledge__search', arguments: 'not json {{{' } },
        ]),
      )
      .mockResolvedValueOnce(completion('Recovered'));

    const res = await runChatTurn('conv_1', 'q', makeContext({ role: 'ops' }));

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(res.toolCalls).toEqual([{ name: 'knowledge.search', status: 'error' }]);
  });

  it('does not hang on adversarial unterminated <function> input (ReDoS guard)', async () => {
    // Many unterminated openings would be O(n²) for a greedy regex; the substring-guarded
    // unwrapper must return promptly. Kept under the length cap so this exercises the
    // `includes('</function>')` guard, not just the size bailout. ~50KB.
    const evil = '<function>'.repeat(5_000) + 'tail';
    createMock
      .mockResolvedValueOnce(
        completion('', [
          { id: 'call_1', type: 'function', function: { name: 'knowledge__search', arguments: evil } },
        ]),
      )
      .mockResolvedValueOnce(completion('Recovered'));

    const start = performance.now();
    const res = await runChatTurn('conv_1', 'q', makeContext({ role: 'ops' }));
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(res.toolCalls).toEqual([{ name: 'knowledge.search', status: 'error' }]);
  });
});
