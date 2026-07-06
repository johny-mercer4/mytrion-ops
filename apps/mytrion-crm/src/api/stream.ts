/**
 * Streaming turns over Server-Sent Events. Two endpoints share one transport:
 *   - streamChat  → POST /v1/chat/stream  (legacy single-agent loop; RAG runs every turn)
 *   - streamAgent → POST /v1/agent        (orchestrator/department agent; RAG is a tool the agent
 *                                          calls only when needed — so "hi" does no retrieval)
 * Both use the Bearer session + one-shot refresh-on-401 retry (a 401 is pre-processing, so retrying
 * the non-idempotent turn once is safe) and respect an AbortSignal at every await.
 */
import { ApiError, authHeaders, refreshBearer } from './transport';
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
  /** Department agent key for direct-to-child on /v1/agent (omit → orchestrator mode). */
  agent?: string;
}

export interface ElicitationOption {
  label: string;
  value: string;
  hint?: string;
}

/** A generative-UI prompt the agent surfaces (e.g. crm.pick_my_client's client picker). */
export interface Elicitation {
  prompt: string;
  field?: string;
  multiSelect?: boolean;
  options: ElicitationOption[];
}

/** A knowledge source backing the answer (agent path; validated server-side post-run). */
export interface Citation {
  id: string;
  title: string;
  marker?: string;
}

export interface StreamHandlers {
  onStart?(data: { conversationId?: string; agent?: string }): void;
  onStatus?(data: { state?: string; label?: string; warnings?: string[] }): void;
  onContext?(data: { passages?: number; citations?: Citation[] }): void;
  onToolCall?(data: { name?: string }): void;
  onToolResult?(data: { name?: string; status?: string }): void;
  /** Chat path emits `{text}`, agent path emits `{delta}` — read either. */
  onToken?(data: { text?: string; delta?: string }): void;
  /** Agent-path only: which child is running ("Consulting Sales…"). */
  onAgent?(data: { key?: string; state?: string; label?: string }): void;
  /** Agent-path only: a dynamic-UI picker the user must answer (their pick is the next turn). */
  onElicitation?(data: Elicitation): void;
  /** `done` is authoritative: message/attribution/citations overwrite in-flight accumulation. */
  onDone?(data: {
    message?: string;
    ragPassages?: number;
    conversationId?: string;
    agentKey?: string;
    agentPath?: string[];
    citations?: Citation[];
  }): void;
  onError?(message: string): void;
}

/** Exported for tests — the pure SSE frame parser/dispatcher. */
export function dispatchFrame(frame: string, h: StreamHandlers): void {
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
    case 'agent': h.onAgent?.(data); break;
    case 'elicitation': h.onElicitation?.(data as unknown as Elicitation); break;
    case 'done': h.onDone?.(data); break;
    case 'error': h.onError?.(typeof data.message === 'string' ? data.message : 'Stream error.'); break;
    default: break;
  }
}

/** Shared SSE transport: POST `path`, stream frames to `handlers`, refresh-on-401 once, honor abort. */
async function runSSE(
  path: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { baseUrl } = resolveApiConfig();
  const url = v1Url(baseUrl, path);

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
    if (res.status === 401 && getSession() && (await refreshBearer())) {
      res = await doFetch();
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    throw e;
  }

  // A non-OK status is a genuine backend error (received + processed). Do NOT retry — a turn is not
  // idempotent; a retry would start a second one. Typed ApiError so the UI can distinguish
  // rate limits (429) from server faults (5xx).
  if (!res.ok) {
    let msg = `The AI service returned HTTP ${res.status}.`;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      msg = j?.error?.message ?? msg;
      code = j?.error?.code;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(msg, code ?? `HTTP_${res.status}`, res.status);
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
  if (!aborted && buffer.trim()) dispatchFrame(buffer, handlers);
}

/** Legacy single-agent chat (always-on RAG). Kept as a fallback when the agent runtime is off. */
export function streamChat(body: ChatRequestBody, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  return runSSE('/chat/stream', body, handlers, signal);
}

/** Orchestrator / department-agent turn. RAG is model-invoked (a greeting triggers no retrieval). */
export function streamAgent(body: ChatRequestBody, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  return runSSE('/agent', { ...body, stream: true }, handlers, signal);
}
