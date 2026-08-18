/**
 * Transport recovery for Render HTTP/2 stream refusals — the origin never saw the request, so
 * one retry is safe, and a cap stops the Sales shell from opening a dozen streams at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, requestBlob } from './transport';
import { jsonResponse } from '../test/sse';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('request network retry', () => {
  it('retries a POST that never reached the origin (HTTP/2 refused stream)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(202, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = request('POST', '/kpi/presence', { body: { sessionId: 's' } });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces NETWORK after a second miss', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const pending = request('GET', '/comms/unread');
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NETWORK',
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
  });

  it('does not retry when retry:false', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('GET', '/comms/unread', { retry: false })).rejects.toMatchObject({
      code: 'NETWORK',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry an aborted request', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('Aborted', 'AbortError'))),
    );
    await expect(
      request('GET', '/comms/unread', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('request concurrency cap', () => {
  it('does not retry a POST that the origin rejected with 502', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(502, { error: { message: 'bad gateway' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('POST', '/kpi/presence', { body: { sessionId: 's' } })).rejects.toMatchObject({
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GET 502 once (origin answered; safe to repeat a read)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, { error: { message: 'bad gateway' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = request('GET', '/comms/unread');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a blob download that never reached the origin', async () => {
    vi.useFakeTimers();
    // jsdom's Response stringifies a Blob argument to "[object Blob]" (13 bytes). Bytes stay bytes.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x70, 0x64, 0x66]), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const pending = requestBlob('/files/x');
    await vi.advanceTimersByTimeAsync(500);
    const got = await pending;
    expect(got.size).toBe(3);
    expect(got.type).toMatch(/pdf/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 6 fetches in flight', async () => {
    let inflight = 0;
    let max = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        inflight += 1;
        max = Math.max(max, inflight);
        await new Promise((resolve) => {
          setTimeout(resolve, 15);
        });
        inflight -= 1;
        return jsonResponse(200, { ok: true });
      }),
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request('GET', '/inbox/messages/counts', { query: { n: i } }),
      ),
    );
    expect(max).toBe(6);
  });
});
