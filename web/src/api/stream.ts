/**
 * Streaming chat (POST /v1/chat/stream, Server-Sent Events). Mirrors the proven widget workaround:
 *  - DIRECT browser fetch + body.getReader() for live tokens.
 *  - On a CORS failure (the widget origin isn't whitelisted), fall back to the buffered Zoho HTTP
 *    proxy (whole response at once) and remember the block for the rest of the session.
 */
import { getZohoSdk } from '../zoho/embeddedApp';
import { resolveApiConfig, v1Url } from './config';
import { unwrap } from './transport';

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

// Sticky for the session: once direct streaming hits CORS, go straight to the proxy.
let directBlocked = false;

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

async function streamViaProxy(
  url: string,
  headers: Record<string, string>,
  payload: string,
  h: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const sdk = await getZohoSdk();
  if (!sdk) throw new Error('Direct streaming was blocked and no Zoho proxy is available.');
  // The proxy is a single buffered request that can't be cancelled mid-flight. If the caller
  // aborted while it was outstanding (e.g. the user started a new chat), drop the late response so
  // its frames don't get dispatched into — and clobber — the now-current conversation.
  const raw = await sdk.CRM.HTTP.post({ url, headers, body: payload });
  if (signal?.aborted) return;
  const text = unwrap(raw);
  const str = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  if (!str.trim()) throw new Error('Empty response from the chat service.');
  for (const frame of str.split('\n\n')) {
    if (signal?.aborted) return;
    dispatchFrame(frame, h);
  }
}

export async function streamChat(
  body: ChatRequestBody,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const cfg = await resolveApiConfig();
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new Error('Backend not configured — set the MYTRION_OPS_API_URL / MYTRION_OPS_API_KEY org variables.');
  }
  const url = v1Url(cfg.baseUrl, '/chat/stream');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey };
  const payload = JSON.stringify(body);
  const sdk = await getZohoSdk();

  if (directBlocked && sdk) {
    await streamViaProxy(url, headers, payload, handlers, signal);
    return;
  }

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: payload, ...(signal ? { signal } : {}) });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    if (sdk) {
      directBlocked = true; // CORS — widget origin not whitelisted; use the proxy from now on
      await streamViaProxy(url, headers, payload, handlers, signal);
      return;
    }
    throw e;
  }

  // A non-OK status is a genuine backend error (the request was received and processed). We do NOT
  // retry it via the proxy: POST /chat/stream is not idempotent — a retry would start a second turn.
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

  // No readable stream (older runtime / proxy buffered) → parse the whole body. Guard the same way
  // as the other two paths: if the caller aborted while the body was in flight, drop the late frames.
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
