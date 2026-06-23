import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
// Configure env BEFORE importing modules that read it (env is parsed once at import).
vi.hoisted(() => {
  process.env.ZOHO_MCP_URL = 'https://crm.zohomcp.com/mcp/abc/message';
  process.env.FF_ZOHO_MCP_ENABLED = '1';
  process.env.FF_ZOHO_MCP_WRITES = '0';
});
vi.stubGlobal('fetch', fetchMock);

import { callMcpTool, listMcpTools, resetMcpSession } from '../../src/integrations/zohoMcp.js';
import { classifyMcpRisk, loadMcpTools } from '../../src/modules/tools/mcpTools.js';
import { ToolRegistry } from '../../src/modules/tools/registry.js';

/** A fetch Response stub whose body is a JSON-RPC result. */
function rpcResponse(result: unknown, sessionId = 'sess_1') {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json', 'mcp-session-id': sessionId }),
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
  };
}

const TOOLS = [
  { name: 'ZohoCRM_getRecords', description: 'Get records', inputSchema: { type: 'object', $schema: 'x', properties: { path_variables: {} } } },
  { name: 'ZohoCRM_executeCOQLQuery', description: 'COQL', inputSchema: { type: 'object' } },
  { name: 'ZohoCRM_updateRecord', description: 'Update', inputSchema: { type: 'object' } },
  { name: 'ZohoCRM_upsertRecords', description: 'Upsert', inputSchema: { type: 'object' } },
];

beforeEach(() => {
  fetchMock.mockReset();
  resetMcpSession();
});

describe('classifyMcpRisk', () => {
  it('classifies read verbs as read — prefixed AND bare names', () => {
    for (const n of [
      // prefixed (this server's actual naming)
      'ZohoCRM_getRecords', 'ZohoCRM_searchRecords', 'ZohoCRM_getRecordCount', 'ZohoCRM_executeCOQLQuery', 'ZohoCRM_getRelatedRecords', 'ZohoCRM_getOrganization',
      // bare camelCase (other MCP servers / future naming)
      'getRecords', 'searchRecords', 'getOrganization', 'executeCOQLQuery',
    ]) {
      expect(classifyMcpRisk(n)).toBe('read');
    }
  });
  it('classifies mutating verbs as write (prefixed + bare), and unknown verbs default to write', () => {
    for (const n of [
      'ZohoCRM_createRecords', 'ZohoCRM_updateRecord', 'ZohoCRM_upsertRecords', 'ZohoCRM_deleteRecord',
      'createRecords', 'updateRecord', 'deleteRecords',
      'markTicketAsRead', // "AsRead" must NOT be read-classified (no leading/_ 'read' token)
      'ZohoCRM_frobnicate', 'frobnicate', // unknown → write
    ]) {
      expect(classifyMcpRisk(n)).toBe('write');
    }
  });
});

describe('zohoMcp client', () => {
  it('initializes a session then lists tools', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcResponse({ protocolVersion: '2025-06-18' })) // initialize
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' }) // notifications/initialized
      .mockResolvedValueOnce(rpcResponse({ tools: TOOLS })); // tools/list
    const tools = await listMcpTools();
    expect(tools.map((t) => t.name)).toContain('ZohoCRM_getRecords');
    // first call is initialize
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string).method).toBe('initialize');
  });

  it('parses SSE-framed tool results and JSON text payloads', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcResponse({})) // initialize
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        text: async () =>
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"count":3}' }] } })}\n\n`,
      });
    const out = await callMcpTool('ZohoCRM_getRecordCount', { path_variables: { module: 'Leads' } });
    expect(out).toEqual({ count: 3 });
  });

  it('throws when the tool result isError', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce(rpcResponse({ content: [{ type: 'text', text: 'INVALID_MODULE' }], isError: true }));
    await expect(callMcpTool('ZohoCRM_getRecords', {})).rejects.toThrow(/INVALID_MODULE/);
  });

  it('surfaces an initialize auth failure as MCP_INIT_FAILED (boot can catch it)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'Authentication required',
    });
    await expect(listMcpTools()).rejects.toThrow(/initialize failed \(HTTP 401\)/);
  });

  it('re-initializes once and retries on a stale-session (404) then returns the result', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcResponse({})) // initialize
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' }) // initialized
      .mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers(), text: async () => 'no session' }) // tools/call → stale
      .mockResolvedValueOnce(rpcResponse({}, 'sess_2')) // re-initialize
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' }) // initialized
      .mockResolvedValueOnce(rpcResponse({ content: [{ type: 'text', text: '{"ok":true}' }] })); // retry → 200
    const out = await callMcpTool('ZohoCRM_getRecords', {});
    expect(out).toEqual({ ok: true });
  });
});

describe('loadMcpTools', () => {
  it('registers only read tools when writes are disabled, with rawParameters + dotted names', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce(rpcResponse({ tools: TOOLS }));
    const tools = await loadMcpTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('zoho_mcp.ZohoCRM_getRecords');
    expect(names).toContain('zoho_mcp.ZohoCRM_executeCOQLQuery');
    expect(names).not.toContain('zoho_mcp.ZohoCRM_updateRecord'); // write, gated off
    expect(names).not.toContain('zoho_mcp.ZohoCRM_upsertRecords');
    const getRecords = tools.find((t) => t.name === 'zoho_mcp.ZohoCRM_getRecords');
    expect(getRecords?.riskClass).toBe('read');
    expect(getRecords?.requiredScopes).toEqual(['zoho_crm:read']);
    // rawParameters is the MCP JSON Schema with the $schema meta key stripped.
    expect(getRecords?.rawParameters).toMatchObject({ type: 'object', properties: { path_variables: {} } });
    expect(getRecords?.rawParameters).not.toHaveProperty('$schema');
  });

  it('registered MCP tools can be added to a ToolRegistry and looked up', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce(rpcResponse({ tools: TOOLS }));
    fetchMock.mockResolvedValue(rpcResponse({ tools: TOOLS })); // any further calls (cached session → tools/list)
    const registry = new ToolRegistry([]);
    registry.register(await loadMcpTools());
    expect(registry.get('zoho_mcp.ZohoCRM_getRecords')).toBeDefined();
    registry.register(await loadMcpTools()); // idempotent — no throw on re-register
    expect(registry.all().filter((t) => t.name.startsWith('zoho_mcp.')).length).toBe(2);
  });
});
