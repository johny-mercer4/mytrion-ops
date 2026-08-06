import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserContext } from '../../context/userContext';

const { getConversation, listConversations } = vi.hoisted(() => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(async () => ({ conversations: [], total: 0 })),
}));

vi.mock('../../api/chat', () => ({
  getConversation,
  listConversations,
  deleteConversation: vi.fn(async () => undefined),
}));
vi.mock('../../api/stream', () => ({
  streamAgent: vi.fn(async () => undefined),
  streamChat: vi.fn(async () => undefined),
}));
vi.mock('../../api/session', () => ({ getSession: vi.fn(() => null) }));

import { useChat } from './useChat';

const ctx: UserContext = {
  userId: 'u-cache', profile: 'Administrator', role: 'admin', userName: 'John', trusted: true,
};

function transcript(id: string) {
  return {
    conversation: { id },
    messages: [{
      id: `a-${id}`, role: 'assistant' as const, content: `answer-${id}`,
      model: 'gpt-test', ragPassages: 0, tools: [], error: null,
      createdAt: '2026-08-06T10:00:00.000Z',
    }],
  };
}

describe('conversation transcript cache', () => {
  beforeEach(() => {
    localStorage.clear();
    getConversation.mockReset();
    getConversation.mockImplementation(async (id: string) => transcript(id));
    listConversations.mockClear();
  });

  it('does not refetch a conversation when switching back to it', async () => {
    const { result } = renderHook(() => useChat(ctx, null));
    await waitFor(() => expect(listConversations).toHaveBeenCalled());

    await act(async () => result.current.openConversation('c1'));
    expect(result.current.messages[0]?.text).toBe('answer-c1');
    await act(async () => result.current.openConversation('c2'));
    expect(result.current.messages[0]?.text).toBe('answer-c2');
    await act(async () => result.current.openConversation('c1'));

    expect(result.current.messages[0]?.text).toBe('answer-c1');
    expect(getConversation).toHaveBeenCalledTimes(2);
  });
});
