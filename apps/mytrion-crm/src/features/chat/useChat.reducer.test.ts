import { describe, expect, it } from 'vitest';
import { classifyStreamError, reducer } from './useChat';
import { ApiError } from '../../api/transport';
import { blankMessage, type UiMessage } from './types';

const EMPTY = { messages: [] as UiMessage[], conversationId: null, streaming: false, conversations: [], error: null };

function sent() {
  return reducer(EMPTY, { type: 'send', text: 'question', userId: 'u1', assistantId: 'a1' });
}

describe('reducer — send', () => {
  it('appends a user+assistant pair and locks streaming', () => {
    const s = sent();
    expect(s.streaming).toBe(true);
    expect(s.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(s.messages[1]).toMatchObject({ status: 'Thinking…', streaming: true, stopped: false });
  });

  it('retires an open elicitation picker (sending IS the answer)', () => {
    const withPicker = {
      ...EMPTY,
      messages: [
        { ...blankMessage('a0', 'assistant', 'pick one'), elicitation: { prompt: 'p', options: [{ label: 'A', value: 'a' }] } },
      ] as UiMessage[],
    };
    const s = reducer(withPicker, { type: 'send', text: 'a', userId: 'u1', assistantId: 'a1' });
    expect(s.messages[0]?.elicitation).toBeNull();
  });
});

describe('reducer — streaming lifecycle', () => {
  it('appendToken accretes text and clears the status label', () => {
    let s = sent();
    s = reducer(s, { type: 'appendToken', text: 'Hel' });
    s = reducer(s, { type: 'appendToken', text: 'lo' });
    expect(s.messages[1]).toMatchObject({ text: 'Hello', status: '' });
  });

  it('stopStream keeps partial text, marks stopped, and unlocks; streamEnd must NOT clear stopped', () => {
    let s = sent();
    s = reducer(s, { type: 'appendToken', text: 'partial' });
    s = reducer(s, { type: 'stopStream' });
    expect(s.streaming).toBe(false);
    expect(s.messages[1]).toMatchObject({ text: 'partial', stopped: true, streaming: false });
    // the aborted stream's finally still fires streamEnd — it must be a no-op for `stopped`
    s = reducer(s, { type: 'streamEnd' });
    expect(s.messages[1]).toMatchObject({ stopped: true, streaming: false });
  });

  it('streamEnd preserves attribution and citations accumulated during the turn', () => {
    let s = sent();
    s = reducer(s, { type: 'appendAgentPath', key: 'sales' });
    s = reducer(s, { type: 'patchAssistant', patch: { citations: [{ id: 'd1', title: 'Doc' }] } });
    s = reducer(s, { type: 'streamEnd' });
    expect(s.messages[1]).toMatchObject({ agentKey: 'sales', agentPath: ['sales'] });
    expect(s.messages[1]?.citations).toEqual([{ id: 'd1', title: 'Doc' }]);
  });

  it('appendAgentPath dedupes consecutive repeats but records real hops', () => {
    let s = sent();
    s = reducer(s, { type: 'appendAgentPath', key: 'sales' });
    s = reducer(s, { type: 'appendAgentPath', key: 'sales' });
    s = reducer(s, { type: 'appendAgentPath', key: 'billing' });
    expect(s.messages[1]?.agentPath).toEqual(['sales', 'billing']);
    expect(s.messages[1]?.agentKey).toBe('billing');
  });
});

describe('reducer — retryTurn', () => {
  it('removes the failed assistant row and its preceding user row', () => {
    let s = sent();
    s = reducer(s, { type: 'patchAssistant', patch: { error: 'boom', errorKind: 'server' } });
    s = reducer(s, { type: 'streamEnd' });
    s = reducer(s, { type: 'retryTurn', assistantId: 'a1' });
    expect(s.messages).toEqual([]);
  });

  it('is a no-op for an unknown id', () => {
    const s = sent();
    expect(reducer(s, { type: 'retryTurn', assistantId: 'nope' }).messages).toHaveLength(2);
  });
});

describe('reducer — conversation switching', () => {
  it('newConversation clears everything and unlocks the composer', () => {
    let s = sent();
    s = reducer(s, { type: 'setConversationId', id: 'c1' });
    s = reducer(s, { type: 'newConversation' });
    expect(s).toMatchObject({ conversationId: null, messages: [], streaming: false, error: null });
  });

  it('loadTranscript replaces messages and clears errors', () => {
    const s = reducer(
      { ...EMPTY, error: 'old' },
      { type: 'loadTranscript', conversationId: 'c2', messages: [blankMessage('m1', 'user', 'hi')] },
    );
    expect(s.conversationId).toBe('c2');
    expect(s.messages).toHaveLength(1);
    expect(s.error).toBeNull();
  });
});

describe('classifyStreamError', () => {
  it('maps 429 → rate-limit, 5xx → server, NETWORK → network, else stream', () => {
    expect(classifyStreamError(new ApiError('x', 'RATE', 429)).kind).toBe('rate-limit');
    expect(classifyStreamError(new ApiError('x', 'HTTP_502', 502)).kind).toBe('server');
    expect(classifyStreamError(new ApiError('x', 'NETWORK', 0)).kind).toBe('network');
    expect(classifyStreamError(new ApiError('x', 'HTTP_400', 400)).kind).toBe('stream');
    expect(classifyStreamError(new Error('weird')).kind).toBe('stream');
  });
});
