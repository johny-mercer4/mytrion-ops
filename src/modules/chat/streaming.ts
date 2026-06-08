import type { FastifyReply } from 'fastify';

export interface SSEStream {
  /** Emit a named SSE event with a JSON data payload. */
  send(event: string, data: unknown): void;
  /** Emit an SSE comment (used as a keep-alive heartbeat). */
  comment(text: string): void;
  close(): void;
}

/**
 * Take over the raw response and switch it to Server-Sent Events. After calling
 * this, Fastify no longer manages the reply (reply.hijack()), so the route must
 * drive the stream to completion and call close().
 */
export function startSSE(reply: FastifyReply, extraHeaders: Record<string, string> = {}): SSEStream {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Disable proxy buffering (nginx/Render) so events flush immediately.
    'X-Accel-Buffering': 'no',
    // hijack() bypasses Fastify's reply headers, so CORS (etc.) must be passed in here.
    ...extraHeaders,
  });

  return {
    send(event, data) {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    comment(text) {
      res.write(`: ${text}\n\n`);
    },
    close() {
      res.end();
    },
  };
}
