/**
 * Streaming chat (POST /v1/chat/stream, Server-Sent Events). Same-origin direct fetch + body
 * .getReader() for live tokens — no CORS, so the Zoho HTTP proxy fallback is gone. Respects an
 * AbortSignal at every await so a cancelled turn never dispatches late frames.
 */
import { authHeaders, refreshBearer } from './transport';
import { getSession } from './session';
import { resolveApiConfig, v1Url } from './config';

export interface ChatRequestBody {
  message: string;
  conversationId?: string;
  zoho_user_id?: string;
  user_name?: string;
  profile?: string;
  role?: string;
  department_scope?: string | string[];
}

export interface StreamHandlers {
  onStart?(data: { conversationId?: string }): void;
  onStatus?(data: { state?: string; label?: string }): void;
  onContext?(data: { passages?: number }): void;
  onToolCall?(data: { name?: string }): void;
  onToolResult?(data: { name?: string; status?: string }): void;
  onToken?(data: { text?: string }): void;
  onDone?(data: { message?: string; ragPassages?: number; conversationId?: string }): void;
  onError?(message: string): void;
}

function dispatchFrame(frame: string, h: StreamHandlers): void {
  if (!frame.trim()) return;
  let ev = 'message';
  let dataStr = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) ev = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataStr) as Record<string, unknown>;
  } catch {
    return;
  }
  switch (ev) {
    case 'start': h.onStart?.(data); break;
    case 'status': h.onStatus?.(data); break;
    case 'context': h.onContext?.(data); break;
    case 'tool_call': h.onToolCall?.(data); break;
    case 'tool_result': h.onToolResult?.(data); break;
    case 'token': h.onToken?.(data); break;
    case 'done': h.onDone?.(data); break;
    case 'error': h.onError?.(typeof data.message === 'string' ? data.message : 'Stream error.'); break;
    default: break;
  }
}

export async function streamChat(
  body: ChatRequestBody,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { baseUrl } = resolveApiConfig();
  const url = v1Url(baseUrl, '/chat/stream');

  // Re-read headers each attempt so a refreshed Bearer token is picked up on retry.
  const doFetch = (): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });

  let res: Response;
  try {
    res = await doFetch();
    // A 401 is rejected pre-processing (no turn started), so refreshing + retrying once is safe
    // even though /chat/stream is otherwise non-idempotent.
    if (res.status === 401 && getSession() && (await refreshBearer())) {
      res = await doFetch();
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    throw e;
  }

  // A non-OK status is a genuine backend error (request received + processed). Do NOT retry —
  // POST /chat/stream is not idempotent; a retry would start a second turn.
  if (!res.ok) {
    let msg = `Chat service returned HTTP ${res.status}.`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      msg = j?.error?.message ?? msg;
    } catch {
      /* non-JSON */
    }
    throw new Error(msg);
  }

  // No readable stream (older runtime) → parse the whole body once, honoring abort.
  if (!res.body || typeof res.body.getReader !== 'function') {
    const txt = await res.text();
    if (signal?.aborted) return;
    for (const frame of txt.split('\n\n')) {
      if (signal?.aborted) return;
      dispatchFrame(frame, handlers);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let aborted = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        aborted = true;
        break;
      }
      throw e;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const frame of parts) dispatchFrame(frame, handlers);
  }
  // Flush a trailing frame only on a clean end — after an abort, a truncated-but-parseable frame
  // must not fire a handler for a turn the caller already walked away from.
  if (!aborted && buffer.trim()) dispatchFrame(buffer, handlers);
}
