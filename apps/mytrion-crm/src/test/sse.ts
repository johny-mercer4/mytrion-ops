/**
 * SSE test helper: a mock `fetch` whose Response body is a ReadableStream fed from SSE frame
 * strings, with controllable chunk boundaries (frames can be split mid-line to exercise the
 * parser's buffering) and abort support.
 */
import { vi } from 'vitest';

export function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Install a fetch mock returning the given responses in sequence (last one repeats). */
export function mockFetchSequence(responses: Array<Response | (() => Response)>): ReturnType<typeof vi.fn> {
  let call = 0;
  const fn = vi.fn(() => {
    const pick = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (!pick) return Promise.reject(new Error('mockFetchSequence: no responses configured'));
    // Response bodies are single-use — allow factories for repeated calls.
    return Promise.resolve(typeof pick === 'function' ? pick() : pick);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Build one SSE frame. */
export function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
