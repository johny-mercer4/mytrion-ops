/**
 * Minimal MCP client for the hosted dbt MCP server (Streamable HTTP, JSON-RPC). Mirrors the tiny
 * surface of zohoMcp.ts (initialize / tools/list / tools/call) but differs in AUTH: this server
 * speaks OAuth, so a headless backend authenticates with the `client_credentials` grant — we POST
 * the client id/secret to the token endpoint, cache the Bearer until just before expiry, and send
 * it on every /mcp call. On a 401 we drop the cached token and retry once (covers early expiry).
 *
 * IDENTITY: Claude.ai gets per-user email via OAuth JWT. Mytrion Ops mints no email on the
 * service token — instead each tools/call forwards the Zoho worker's email as `X-User-Email`
 * so the MCP's query-memory RAG scopes personally (same agentic recall Claude gets). That identity
 * lives on TenantContext / this header — never in the LLM system prompt.
 *
 * Credentials are secrets → env only (DBT_MCP_CLIENT_ID/SECRET), never in code.
 *
 * ISOLATION NOTE: free-SQL `query` is registered as admin-only (department policy) behind
 * FF_DBT_MCP_ENABLED; `run`/`test` also need FF_DBT_MCP_WRITES. See modules/tools/dbtMcpTools.ts.
 */
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT_MS = 25_000;
/** Refresh the token this long before its stated expiry, so a call never races the boundary. */
const TOKEN_SKEW_MS = 60_000;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DbtMcpCallOptions {
  /** Zoho worker email → MCP `X-User-Email` (query-memory RAG identity). */
  userEmail?: string;
  /** Raw Zoho user id (no `zoho:` prefix) → `X-User-Id`. Warehouse row-scoping key. */
  userId?: string;
  /** Display name → `X-User-Name`. */
  userName?: string;
  /** Caller role (internal role or Zoho role string) → `X-User-Role`. */
  role?: string;
  /** Whether the caller sees everything (allDepartmentAccess) → `X-User-Admin`. Non-admins are
   *  scoped to their own data by the CURATED tool that builds the SQL — this header is advisory
   *  (audit + future server-side enforcement), never the sole gate. */
  isAdmin?: boolean;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

// One cached session + token per process; both re-established on demand if the server drops them.
let sessionId: string | null = null;
let nextId = 1;
let cachedToken: { value: string; expiresAt: number } | null = null;

/** The OAuth token endpoint: explicit DBT_MCP_TOKEN_URL, else `${origin}/token` from the MCP URL. */
function tokenUrl(): string {
  if (env.DBT_MCP_TOKEN_URL) return env.DBT_MCP_TOKEN_URL;
  return `${new URL(env.DBT_MCP_URL).origin}/token`;
}

/** Fetch a fresh Bearer via the client_credentials grant. Throws on auth/transport failure. */
async function fetchToken(): Promise<{ value: string; expiresAt: number }> {
  if (!env.DBT_MCP_URL) throw new AppError('DBT_MCP_URL is not configured', { code: 'DBT_MCP_NOT_CONFIGURED' });
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.DBT_MCP_CLIENT_ID,
    client_secret: env.DBT_MCP_CLIENT_SECRET,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new AppError(`dbt MCP token failed (HTTP ${res.status}): ${json.error ?? 'no access_token'}`, {
      code: 'DBT_MCP_AUTH_FAILED',
      statusCode: 502,
    });
  }
  const ttlSec = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  return { value: json.access_token, expiresAt: Date.now() + ttlSec * 1000 };
}

async function bearer(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_SKEW_MS > Date.now()) return cachedToken.value;
  cachedToken = await fetchToken();
  return cachedToken.value;
}

/** Header value must be ASCII/latin1-safe; drop anything else so fetch never throws on a name. */
function headerSafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[^\x20-\x7E]/g, '').trim();
}

function baseHeaders(token: string, identity?: DbtMcpCallOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (!identity) return headers;
  const email = identity.userEmail?.trim().toLowerCase();
  if (email && email.includes('@')) headers['X-User-Email'] = email;
  if (identity.userId?.trim()) headers['X-User-Id'] = headerSafe(identity.userId);
  if (identity.userName?.trim()) headers['X-User-Name'] = headerSafe(identity.userName);
  if (identity.role?.trim()) headers['X-User-Role'] = headerSafe(identity.role);
  if (identity.isAdmin !== undefined) headers['X-User-Admin'] = identity.isAdmin ? 'true' : 'false';
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
async function postRaw(
  payload: Record<string, unknown>,
  token: string,
  identity?: DbtMcpCallOptions,
): Promise<Response> {
  const url = env.DBT_MCP_URL;
  if (!url) throw new AppError('DBT_MCP_URL is not configured', { code: 'DBT_MCP_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: baseHeaders(token, identity),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function post(method: string, params: unknown, identity?: DbtMcpCallOptions): Promise<RpcOutcome> {
  const token = await bearer();
  const res = await postRaw({ jsonrpc: '2.0', id: nextId++, method, params }, token, identity);
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
  const token = await bearer().catch(() => '');
  if (!token) return;
  await postRaw({ jsonrpc: '2.0', method, params: {} }, token).catch(() => undefined);
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
      `dbt MCP initialize failed (HTTP ${init.httpStatus}): ${init.rpc?.error?.message ?? init.bodySnippet}`,
      { code: 'DBT_MCP_INIT_FAILED', statusCode: 502 },
    );
  }
  sessionId = init.newSessionId; // may be null if the server is stateless
  await notify('notifications/initialized');
}

/** A stale/expired session (404 or explicit "session" signal) → re-initialize once and retry. */
function isSessionError(o: RpcOutcome): boolean {
  if (o.httpStatus === 404) return true;
  const msg = o.rpc?.error?.message?.toLowerCase() ?? '';
  return msg.includes('session');
}

async function call(method: string, params: unknown, identity?: DbtMcpCallOptions): Promise<unknown> {
  await ensureSession();
  let out = await post(method, params, identity);

  // 401 → the Bearer likely expired early; drop it, re-auth + re-init, retry once.
  if (out.httpStatus === 401) {
    cachedToken = null;
    sessionId = null;
    await ensureSession();
    out = await post(method, params, identity);
  }

  if (isSessionError(out) && sessionId !== null) {
    sessionId = null;
    await ensureSession();
    out = await post(method, params, identity);
  }

  if (out.httpStatus !== 200 || !out.rpc) {
    throw new AppError(`dbt MCP ${method} HTTP ${out.httpStatus}: ${out.bodySnippet}`, {
      code: 'DBT_MCP_HTTP_ERROR',
      statusCode: 502,
    });
  }
  if (out.rpc.error) {
    throw new AppError(`dbt MCP ${method} error: ${out.rpc.error.message ?? 'unknown'}`, {
      code: 'DBT_MCP_RPC_ERROR',
      statusCode: 502,
    });
  }
  return out.rpc.result;
}

/** List the tools the connected dbt MCP server exposes. */
export async function listDbtTools(): Promise<McpToolDef[]> {
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

/**
 * Invoke one dbt MCP tool. Throws (so the dispatcher records an error) when the tool reports
 * failure. Returns structuredContent when present, else parses text blocks as JSON (raw text if not).
 * Pass `opts.userEmail` (Zoho worker) so server-side query memory RAG is personal, not shared.
 */
export async function callDbtTool(
  name: string,
  args: Record<string, unknown>,
  opts: DbtMcpCallOptions = {},
): Promise<unknown> {
  const result = (await call('tools/call', { name, arguments: args }, opts)) as CallToolResult;
  const blocks = (result.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);

  if (result.isError) {
    const detail =
      blocks.join('\n') ||
      (result.structuredContent !== undefined ? JSON.stringify(result.structuredContent) : '') ||
      'tool error';
    throw new AppError(`dbt MCP tool ${name} failed: ${detail.slice(0, 300)}`, {
      code: 'DBT_MCP_TOOL_ERROR',
      statusCode: 502,
    });
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
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

/** For tests/smoke: reset the cached session + token. */
export function resetDbtMcp(): void {
  sessionId = null;
  cachedToken = null;
}
