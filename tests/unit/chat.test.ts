import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMock, dispatchMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  dispatchMock: vi.fn(),
}));

vi.mock('../../src/modules/llm/openaiClient.js', () => ({
  getOpenAI: () => ({ chat: { completions: { create: createMock } } }),
  models: { default: 'gpt-4o-mini', reasoning: 'gpt-4o', embedding: 'text-embedding-3-small' },
}));
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
});

describe('runChatTurn', () => {
  it('returns the assistant answer for a no-tool turn', async () => {
    createMock.mockResolvedValueOnce(completion('Hello from Octane'));
    const res = await runChatTurn(undefined, 'hi', makeContext({ role: 'ops' }));
    expect(res.message).toBe('Hello from Octane');
    expect(res.iterations).toBe(1);
    expect(res.toolCalls).toEqual([]);
    expect(res.usage.promptTokens).toBe(10);
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
});
