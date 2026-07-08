import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchFrame, streamAgent, type StreamHandlers } from './stream';
import { ApiError } from './transport';
import { frame, jsonResponse, mockFetchSequence, sseResponse } from '../test/sse';

const SESSION_KEY = 'octane.session.v1';

function handlersWithSpies(): { handlers: StreamHandlers; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const spy = (name: string) => (data: unknown) => {
    (calls[name] ??= []).push(data);
  };
  return {
    handlers: {
      onStart: spy('start'),
      onStatus: spy('status'),
      onContext: spy('context'),
      onToolCall: spy('tool_call'),
      onToolResult: spy('tool_result'),
      onToken: spy('token'),
      onAgent: spy('agent'),
      onElicitation: spy('elicitation'),
      onDone: spy('done'),
      onError: spy('error'),
    },
    calls,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('dispatchFrame (pure SSE parser)', () => {
  it('routes every event type to its handler', () => {
    const { handlers, calls } = handlersWithSpies();
    dispatchFrame('event: start\ndata: {"conversationId":"c1"}', handlers);
    dispatchFrame('event: token\ndata: {"delta":"hi"}', handlers);
    dispatchFrame('event: agent\ndata: {"key":"sales","state":"start","label":"Sales"}', handlers);
    dispatchFrame('event: context\ndata: {"passages":3,"citations":[{"id":"d1","title":"T"}]}', handlers);
    dispatchFrame('event: done\ndata: {"message":"x","agentKey":"sales","agentPath":["sales"]}', handlers);
    dispatchFrame('event: error\ndata: {"message":"boom"}', handlers);
    expect(calls['start']).toEqual([{ conversationId: 'c1' }]);
    expect(calls['token']).toEqual([{ delta: 'hi' }]);
    expect(calls['agent']).toEqual([{ key: 'sales', state: 'start', label: 'Sales' }]);
    expect(calls['context']).toEqual([{ passages: 3, citations: [{ id: 'd1', title: 'T' }] }]);
    expect(calls['done']).toEqual([{ message: 'x', agentKey: 'sales', agentPath: ['sales'] }]);
    expect(calls['error']).toEqual(['boom']);
  });

  it('ignores empty frames and malformed JSON without throwing', () => {
    const { handlers, calls } = handlersWithSpies();
    dispatchFrame('', handlers);
    dispatchFrame('event: token\ndata: {not json', handlers);
    dispatchFrame('event: token', handlers);
    expect(calls['token']).toBeUndefined();
  });

  it('concatenates multi-line data', () => {
    const { handlers, calls } = handlersWithSpies();
    dispatchFrame('event: token\ndata: {"delta":\ndata: "ab"}', handlers);
    expect(calls['token']).toEqual([{ delta: 'ab' }]);
  });
});

describe('streamAgent (transport)', () => {
  it('parses frames split across arbitrary chunk boundaries and flushes the final frame', async () => {
    const full =
      frame('start', { conversationId: 'c9' }) +
      frame('token', { delta: 'Hel' }) +
      frame('token', { delta: 'lo' }) +
      // final frame deliberately UNTERMINATED (no trailing \n\n)
      'event: done\ndata: {"message":"Hello","conversationId":"c9"}';
    // Split mid-line to exercise buffering.
    const chunks = [full.slice(0, 17), full.slice(17, 55), full.slice(55)];
    mockFetchSequence([sseResponse(chunks)]);

    const { handlers, calls } = handlersWithSpies();
    await streamAgent({ message: 'hi' }, handlers);
    expect(calls['token']).toEqual([{ delta: 'Hel' }, { delta: 'lo' }]);
    expect(calls['done']).toEqual([{ message: 'Hello', conversationId: 'c9' }]);
  });

  it('throws a typed ApiError with the status on non-OK (429)', async () => {
    mockFetchSequence([jsonResponse(429, { error: { message: 'Rate limited', code: 'RATE_LIMIT' } })]);
    const { handlers } = handlersWithSpies();
    const err = await streamAgent({ message: 'hi' }, handlers).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).message).toBe('Rate limited');
  });

  it('refreshes once on 401 with a session, then retries exactly once', async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ accessToken: 'old', refreshToken: 'r1', worker: { zohoUserId: '1' } }),
    );
    const fetchMock = mockFetchSequence([
      jsonResponse(401, { error: { message: 'expired' } }), // first turn attempt
      jsonResponse(200, { accessToken: 'new', refreshToken: 'r2' }), // /auth/refresh
      () => sseResponse([frame('done', { message: 'ok' })]), // retried turn
    ]);

    const { handlers, calls } = handlersWithSpies();
    await streamAgent({ message: 'hi' }, handlers);
    expect(calls['done']).toEqual([{ message: 'ok' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') as { accessToken?: string };
    expect(stored.accessToken).toBe('new');
  });

  it('a second 401 after refresh surfaces the error (no retry loop)', async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ accessToken: 'old', refreshToken: 'r1', worker: { zohoUserId: '1' } }),
    );
    mockFetchSequence([
      () => jsonResponse(401, { error: { message: 'expired' } }),
      () => jsonResponse(200, { accessToken: 'new', refreshToken: 'r2' }),
      () => jsonResponse(401, { error: { message: 'still expired' } }),
    ]);
    const err = await streamAgent({ message: 'hi' }, handlersWithSpies().handlers).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(401);
  });

  it('returns silently when aborted before the response arrives', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        });
      }),
    );
    const { handlers, calls } = handlersWithSpies();
    const p = streamAgent({ message: 'hi' }, handlers, controller.signal);
    controller.abort();
    await expect(p).resolves.toBeUndefined();
    expect(calls['done']).toBeUndefined();
  });
});
