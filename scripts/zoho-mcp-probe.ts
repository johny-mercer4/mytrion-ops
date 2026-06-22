import 'dotenv/config';
/**
 * Zoho MCP feasibility probe — answers the ONE decisive question before we build any bridge:
 * can a cold, headless backend process (no browser, no Zoho session/cookie) authenticate to a
 * hosted Zoho MCP server using only its generated URL (+ optional bearer)?
 *
 * It speaks raw MCP over Streamable HTTP (JSON-RPC POST: initialize → tools/list) so we don't add
 * the MCP SDK until we know it's viable. Read-only: it only lists tools, never calls a write tool.
 *
 *   1) Create a server in the Zoho MCP console (start with CRM "Data Insights" = read-only),
 *      choose "Authorization via Connections" and complete the one-time Super Admin consent.
 *   2) Put the generated URL in .env as ZOHO_MCP_URL (and ZOHO_MCP_AUTH if a token is issued).
 *   3) Run: pnpm zoho:mcp-probe
 */
const URL_ = process.env.ZOHO_MCP_URL?.trim();
const AUTH = process.env.ZOHO_MCP_AUTH?.trim();
const PROTOCOL_VERSION = '2025-06-18';

function headers(sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    // Streamable HTTP servers may reply as JSON or as an SSE stream — accept both.
    Accept: 'application/json, text/event-stream',
  };
  if (AUTH) h.Authorization = AUTH.toLowerCase().startsWith('bearer ') ? AUTH : `Bearer ${AUTH}`;
  if (sessionId) h['Mcp-Session-Id'] = sessionId;
  return h;
}

/** Extract the first JSON-RPC object from a response body (handles both JSON and SSE framing). */
function parseRpc(contentType: string, text: string): Record<string, unknown> | null {
  if (contentType.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^data:\s*(.*)$/.exec(line);
      if (m?.[1]) {
        try {
          return JSON.parse(m[1]) as Record<string, unknown>;
        } catch {
          /* keep scanning */
        }
      }
    }
    return null;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface RpcResult {
  httpStatus: number;
  contentType: string;
  sessionId: string | undefined;
  rpc: Record<string, unknown> | null;
  bodySnippet: string;
}

async function rpc(method: string, params: unknown, sessionId?: string): Promise<RpcResult> {
  const res = await fetch(URL_ as string, {
    method: 'POST',
    headers: headers(sessionId),
    redirect: 'manual', // a 3xx to a login page is itself the "interactive auth required" signal
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  return {
    httpStatus: res.status,
    contentType,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    rpc: parseRpc(contentType, text),
    bodySnippet: text.slice(0, 400),
  };
}

function verdict(line: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n  ${'─'.repeat(60)}\n  ${line}\n  ${'─'.repeat(60)}\n`);
}

async function main(): Promise<void> {
  if (!URL_) {
    verdict('SKIP — set ZOHO_MCP_URL in .env first (see this file’s header for the console steps).');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[zoho-mcp] probing ${URL_.replace(/\/\/[^/]+/, '//<host>')} ${AUTH ? '(with bearer)' : '(URL-only auth)'}`);

  const init = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'octane-assistant-probe', version: '0.1.0' },
  });
  // eslint-disable-next-line no-console
  console.log(`[zoho-mcp] initialize → HTTP ${init.httpStatus} (${init.contentType || 'no content-type'})`);

  const looksLikeLogin =
    (init.httpStatus >= 300 && init.httpStatus < 400) ||
    init.httpStatus === 401 ||
    init.httpStatus === 403 ||
    init.contentType.includes('text/html');
  if (looksLikeLogin || !init.rpc || 'error' in (init.rpc ?? {})) {
    // eslint-disable-next-line no-console
    console.log(`[zoho-mcp] body: ${init.bodySnippet}`);
    verdict('❌ HEADLESS AUTH FAILED — hosted Zoho MCP needs an interactive session/consent. ' +
      'Stay on the direct REST integration.');
    process.exitCode = 1;
    return;
  }

  // Authenticated. Complete the handshake and list tools (read-only).
  await rpc('notifications/initialized', {}, init.sessionId).catch(() => undefined);
  const list = await rpc('tools/list', {}, init.sessionId);
  const tools = ((list.rpc?.result as { tools?: Array<{ name: string }> } | undefined)?.tools) ?? [];
  // eslint-disable-next-line no-console
  console.log(`[zoho-mcp] tools/list → HTTP ${list.httpStatus}, ${tools.length} tool(s)`);
  if (tools.length > 0) {
    // eslint-disable-next-line no-console
    console.log('  e.g. ' + tools.slice(0, 12).map((t) => t.name).join(', '));
  }
  verdict(`✅ HEADLESS AUTH WORKS — ${tools.length} tools reachable with no browser. ` +
    'We can build the gated MCP bridge (Phase 1, read-only, behind a flag).');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[zoho-mcp] probe crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
