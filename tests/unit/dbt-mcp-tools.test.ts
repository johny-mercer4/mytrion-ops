import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, getMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), getMock: vi.fn() }));
vi.hoisted(() => {
  process.env.DBT_MCP_URL = 'https://mcp.example.com/mcp';
  process.env.DBT_MCP_CLIENT_ID = 'mytrion-ops';
  process.env.DBT_MCP_CLIENT_SECRET = 'secret';
  process.env.FF_DBT_MCP_ENABLED = '1';
  process.env.FF_DBT_MCP_WRITES = '0';
});
vi.stubGlobal('fetch', fetchMock);

// warehouse.my_gallons resolves the caller's carrier roster via servercrm before summing gallons.
vi.mock('../../src/integrations/serverCrm.js', () => ({
  serverCrmGet: getMock,
  serverCrmPost: vi.fn(),
}));

import { callDbtTool, listDbtTools, resetDbtMcp } from '../../src/integrations/dbtMcp.js';
import { env } from '../../src/config/env.js';
import {
  classifyDbtMcpRisk,
  dbtIdentityFromContext,
  loadDbtMcpTools,
} from '../../src/modules/tools/dbtMcpTools.js';
import { warehouseMyGallonsTool } from '../../src/modules/tools/definitions/warehouse_gallons.js';
import { ToolRegistry } from '../../src/modules/tools/registry.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

// env is parsed once — flip flags on the live object (same pattern as composio / hybrid tests).
env.FF_DBT_MCP_ENABLED = true;
env.FF_DBT_MCP_WRITES = false;

function rpcResponse(result: unknown, sessionId = 'sess_dbt') {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json', 'mcp-session-id': sessionId }),
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
  };
}

function tokenResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'tok_test', expires_in: 3600 }),
  };
}

const TOOLS = [
  {
    name: 'recall_similar_queries',
    description: 'Recall proven SQL',
    inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    name: 'query',
    description: 'Run SELECT',
    inputSchema: { type: 'object', properties: { sql: {}, question: {} }, required: ['sql', 'question'] },
  },
  { name: 'run', description: 'dbt run', inputSchema: { type: 'object' } },
  { name: 'test', description: 'dbt test', inputSchema: { type: 'object' } },
];

const adminCtx = (): TenantContext => ({
  tenantId: 'octane',
  userId: 'zoho:1',
  audience: 'internal',
  role: 'admin',
  scopes: ['*'],
  departments: [],
  allDepartmentAccess: true,
  email: 'alice@octane.example',
  requestId: 'req_1',
});

beforeEach(() => {
  fetchMock.mockReset();
  getMock.mockReset();
  resetDbtMcp();
});

describe('classifyDbtMcpRisk', () => {
  it('treats recall + query as read and run/test/unknown as write', () => {
    expect(classifyDbtMcpRisk('recall_similar_queries')).toBe('read');
    expect(classifyDbtMcpRisk('query')).toBe('read');
    expect(classifyDbtMcpRisk('run')).toBe('write');
    expect(classifyDbtMcpRisk('test')).toBe('write');
    expect(classifyDbtMcpRisk('frobnicate')).toBe('write');
  });
});

describe('dbtMcp client identity', () => {
  it('forwards X-User-Email on tools/call from Zoho worker context', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse()) // client_credentials
      .mockResolvedValueOnce(rpcResponse({ protocolVersion: '2025-06-18' })) // initialize
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' }) // notify
      .mockResolvedValueOnce(
        rpcResponse({
          content: [{ type: 'text', text: 'No similar past queries found.' }],
          isError: false,
        }),
      );

    await callDbtTool('recall_similar_queries', { question: 'gallons in March?' }, {
      userEmail: 'alice@octane.example',
    });

    const toolCall = fetchMock.mock.calls.find((c) => {
      const body = (c[1] as RequestInit | undefined)?.body;
      return typeof body === 'string' && body.includes('"tools/call"');
    });
    expect(toolCall).toBeTruthy();
    const headers = (toolCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-User-Email']).toBe('alice@octane.example');
  });
});

describe('loadDbtMcpTools', () => {
  it('registers read tools only when writes flag is off', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce(rpcResponse({ tools: TOOLS }));

    const tools = await loadDbtMcpTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['dbt_mcp.query', 'dbt_mcp.recall_similar_queries']);
    expect(tools.every((t) => t.riskClass === 'read')).toBe(true);
  });

  it('passes ctx.email into callDbtTool when run', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce(rpcResponse({ tools: TOOLS }))
      // second session path for call after list may reuse token/session
      .mockResolvedValueOnce(
        rpcResponse({
          content: [{ type: 'text', text: JSON.stringify({ rows: 0 }) }],
          isError: false,
        }),
      );

    const tools = await loadDbtMcpTools();
    const recall = tools.find((t) => t.name === 'dbt_mcp.recall_similar_queries');
    expect(recall).toBeTruthy();
    await recall!.run({ question: 'test?' }, adminCtx());

    const toolCall = fetchMock.mock.calls.find((c) => {
      const body = (c[1] as RequestInit | undefined)?.body;
      return typeof body === 'string' && body.includes('"tools/call"');
    });
    const headers = (toolCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-User-Email']).toBe('alice@octane.example');
  });

  it('registers into a ToolRegistry idempotently', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(rpcResponse({}))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce(rpcResponse({ tools: TOOLS }));

    const registry = new ToolRegistry([]);
    const loaded = await loadDbtMcpTools();
    registry.register(loaded);
    registry.register(loaded);
    expect(registry.get('dbt_mcp.query')).toBeTruthy();
  });
});

const workerCtx = (over: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: 'octane',
  userId: 'zoho:6096698000139541886',
  audience: 'internal',
  role: 'worker',
  scopes: ['servercrm:read'],
  departments: ['sales'],
  allDepartmentAccess: false,
  userName: 'Shohruh Bekmurodov',
  callerRole: 'Sales Agent',
  requestId: 'req_w',
  ...over,
});

/** Stage one servercrm by-agent roster response (carrier ids the caller owns). */
function mockRoster(carrierIds: number[], agentName = 'Shohruh Bekmurodov') {
  getMock.mockResolvedValueOnce({
    agent_name: agentName,
    data: carrierIds.map((id) => ({ carrier_id: id, company_name: `Carrier ${id}` })),
  });
}

/** Prime fetch for one full tools/call cycle (token → initialize → notify → call) and return the SQL. */
async function runGallons(
  ctx: TenantContext,
  input: { period?: 'today' | 'this_week' | 'this_month'; agentZohoUserId?: string },
) {
  fetchMock
    .mockResolvedValueOnce(tokenResponse())
    .mockResolvedValueOnce(rpcResponse({ protocolVersion: '2025-06-18' }))
    .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
    .mockResolvedValueOnce(
      rpcResponse({
        content: [{ type: 'text', text: 'Query returned 1 rows.\n\nColumns: [gallons, swipes]\n\nData:\n[[123, 45]]' }],
        isError: false,
      }),
    );
  const parsed = warehouseMyGallonsTool.inputSchema.parse(input);
  const out = await warehouseMyGallonsTool.handler(parsed, ctx);
  const toolCall = fetchMock.mock.calls.find((c) => {
    const body = (c[1] as RequestInit | undefined)?.body;
    return typeof body === 'string' && body.includes('"tools/call"');
  });
  const body = JSON.parse((toolCall?.[1] as RequestInit).body as string);
  const headers = (toolCall?.[1] as RequestInit).headers as Record<string, string>;
  return { out, sql: body.params.arguments.sql as string, headers };
}

describe('dbtIdentityFromContext', () => {
  it('strips the zoho: prefix and marks non-admins', () => {
    const id = dbtIdentityFromContext(workerCtx());
    expect(id.userId).toBe('6096698000139541886');
    expect(id.isAdmin).toBe(false);
    expect(id.role).toBe('Sales Agent');
    expect(id.userName).toBe('Shohruh Bekmurodov');
  });
});

describe('warehouse.my_gallons scoping', () => {
  it('sums a non-admin over their OWN carrier book (never company-wide)', async () => {
    mockRoster([111, 222]);
    const { out, sql, headers } = await runGallons(workerCtx(), { period: 'this_month' });
    expect(out.scope).toBe('self');
    expect(out.carriersInBook).toBe(2);
    // Roster fetched for the caller's OWN zoho id.
    expect(getMock).toHaveBeenCalledWith(
      '/api/clients/by-agent/6096698000139541886',
      expect.objectContaining({ limit: 200 }),
    );
    // Warehouse sum is filtered to the carriers they own.
    expect(sql).toContain('t.carrier_id in (111, 222)');
    expect(headers['X-User-Id']).toBe('6096698000139541886');
    expect(headers['X-User-Admin']).toBe('false');
  });

  it('ignores an agentZohoUserId override from a non-admin (roster stays self)', async () => {
    mockRoster([111]);
    const { out } = await runGallons(workerCtx(), { agentZohoUserId: '999999' });
    expect(out.scope).toBe('self');
    expect(getMock).toHaveBeenCalledWith(
      '/api/clients/by-agent/6096698000139541886',
      expect.anything(),
    );
  });

  it('returns zeros without querying the warehouse when the book is empty', async () => {
    mockRoster([]);
    const out = await warehouseMyGallonsTool.handler(
      warehouseMyGallonsTool.inputSchema.parse({}),
      workerCtx(),
    );
    expect(out.scope).toBe('self');
    expect(out.carriersInBook).toBe(0);
    // No MCP round-trip when there are no carriers to sum.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an admin go company-wide (no roster, no carrier filter)', async () => {
    const { out, sql } = await runGallons(workerCtx({ role: 'admin', allDepartmentAccess: true }), {
      period: 'this_week',
    });
    expect(out.scope).toBe('company');
    expect(getMock).not.toHaveBeenCalled();
    expect(sql).not.toContain('t.carrier_id in');
    expect(sql).toContain("date_trunc('week'");
  });

  it('lets an admin target one agent by zoho id (their book)', async () => {
    mockRoster([333, 444], 'Bob Boss');
    const { out, sql } = await runGallons(workerCtx({ role: 'admin', allDepartmentAccess: true }), {
      agentZohoUserId: '6227679000111111111',
    });
    expect(out.scope).toBe('agent');
    expect(out.agentName).toBe('Bob Boss');
    expect(getMock).toHaveBeenCalledWith(
      '/api/clients/by-agent/6227679000111111111',
      expect.anything(),
    );
    expect(sql).toContain('t.carrier_id in (333, 444)');
  });

  it('is granted the servercrm:read scope and read risk', () => {
    expect(warehouseMyGallonsTool.riskClass).toBe('read');
    expect(warehouseMyGallonsTool.requiredScopes).toEqual(['servercrm:read']);
  });
});

describe('listDbtTools', () => {
  it('lists tools after OAuth + initialize', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(rpcResponse({ protocolVersion: '2025-06-18' }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => '' })
      .mockResolvedValueOnce(rpcResponse({ tools: TOOLS }));

    const tools = await listDbtTools();
    expect(tools.map((t) => t.name)).toContain('query');
  });
});
