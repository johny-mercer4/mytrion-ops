/**
 * Minimal MCP client for Zoho's hosted MCP server (Streamable HTTP transport). We speak raw
 * JSON-RPC rather than pull in the MCP SDK — the surface we need is tiny (initialize, tools/list,
 * tools/call) and this keeps the dependency footprint and ESM friction low.
 *
 * Auth: the per-server URL is created in the Zoho MCP console with "Authorize via Connection", so it
 * embeds the credential and authenticates a headless backend with no browser/OAuth (verified). The
 * URL is therefore a secret — it lives in env.ZOHO_MCP_URL (gitignored), never in code.
 */
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT_MS = 25_000;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

// One cached session per process; re-established on demand if the server drops it.
let sessionId: string | null = null;
let nextId = 1;

function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  return headers;
}

/** Extract the first JSON-RPC object from a response body (handles JSON and SSE framing). */
function parseBody(contentType: string, text: string): JsonRpcResponse | null {
  if (contentType.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^data:\s*(.*)$/.exec(line);
      if (m?.[1]) {
        try {
          return JSON.parse(m[1]) as JsonRpcResponse;
        } catch {
          /* keep scanning */
        }
      }
    }
    return null;
  }
  try {
    return text ? (JSON.parse(text) as JsonRpcResponse) : null;
  } catch {
    return null;
  }
}

interface RpcOutcome {
  httpStatus: number;
  rpc: JsonRpcResponse | null;
  newSessionId: string | null;
  bodySnippet: string;
}

/** Single POST to the MCP endpoint, always bounded by REQUEST_TIMEOUT_MS (so nothing can hang). */
async function postRaw(payload: Record<string, unknown>): Promise<Response> {
  const url = env.ZOHO_MCP_URL;
  if (!url) throw new AppError('ZOHO_MCP_URL is not configured', { code: 'MCP_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function post(method: string, params: unknown): Promise<RpcOutcome> {
  const res = await postRaw({ jsonrpc: '2.0', id: nextId++, method, params });
  const text = await res.text();
  return {
    httpStatus: res.status,
    rpc: parseBody(res.headers.get('content-type') ?? '', text),
    newSessionId: res.headers.get('mcp-session-id'),
    bodySnippet: text.slice(0, 300),
  };
}

/** Notifications carry no id and expect no body; fire-and-forget but still timeout-bounded. */
async function notify(method: string): Promise<void> {
  await postRaw({ jsonrpc: '2.0', method, params: {} }).catch(() => undefined);
}

/** Open (or reuse) an MCP session. Throws on an auth/transport failure so callers can surface it. */
async function ensureSession(): Promise<void> {
  if (sessionId) return;
  const init = await post('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'octane-assistant', version: '0.1.0' },
  });
  if (init.httpStatus !== 200 || !init.rpc || init.rpc.error) {
    throw new AppError(
      `Zoho MCP initialize failed (HTTP ${init.httpStatus}): ${init.rpc?.error?.message ?? init.bodySnippet}`,
      { code: 'MCP_INIT_FAILED', statusCode: 502 },
    );
  }
  sessionId = init.newSessionId; // may be null if the server doesn't use session ids
  await notify('notifications/initialized');
}

/**
 * True when an error looks like a stale/expired session, so we re-initialize once and retry.
 * Scoped to 404 or an explicit "session" signal — a bare 400 is usually bad arguments, not a stale
 * session, and shouldn't trigger a pointless re-init + retry of the same failing call.
 */
function isSessionError(o: RpcOutcome): boolean {
  if (o.httpStatus === 404) return true;
  const msg = o.rpc?.error?.message?.toLowerCase() ?? '';
  return msg.includes('session');
}

async function call(method: string, params: unknown): Promise<unknown> {
  await ensureSession();
  let out = await post(method, params);
  if (isSessionError(out) && sessionId !== null) {
    sessionId = null;
    await ensureSession();
    out = await post(method, params);
  }
  if (out.httpStatus !== 200 || !out.rpc) {
    throw new AppError(`Zoho MCP ${method} HTTP ${out.httpStatus}: ${out.bodySnippet}`, {
      code: 'MCP_HTTP_ERROR',
      statusCode: 502,
    });
  }
  if (out.rpc.error) {
    throw new AppError(`Zoho MCP ${method} error: ${out.rpc.error.message ?? 'unknown'}`, {
      code: 'MCP_RPC_ERROR',
      statusCode: 502,
    });
  }
  return out.rpc.result;
}

/** List the tools the connected Zoho MCP server exposes. */
export async function listMcpTools(): Promise<McpToolDef[]> {
  const result = (await call('tools/list', {})) as { tools?: McpToolDef[] } | undefined;
  return (result?.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
  }));
}

interface CallToolResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Invoke one MCP tool. Throws (so the dispatcher records an error) when the tool reports failure. */
export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = (await call('tools/call', { name, arguments: args })) as CallToolResult;
  const blocks = (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);

  if (result.isError) {
    const detail =
      blocks.join('\n') ||
      (result.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : '') ||
      'tool error';
    throw new AppError(`Zoho MCP tool ${name} failed: ${detail.slice(0, 300)}`, {
      code: 'MCP_TOOL_ERROR',
      statusCode: 502,
    });
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  // CRM returns JSON-as-text. Parse each block independently (joining first would break multi-block
  // JSON); return a single value for one block, an array for several, raw text when not JSON.
  const parsed = blocks.map((b) => {
    try {
      return JSON.parse(b);
    } catch {
      return b;
    }
  });
  if (parsed.length === 0) return null;
  return parsed.length === 1 ? parsed[0] : parsed;
}

/** For tests: reset the cached session. */
export function resetMcpSession(): void {
  sessionId = null;
}
