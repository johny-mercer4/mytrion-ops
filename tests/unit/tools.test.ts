import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { env } from '../../src/config/env.js';
import { DEFAULT_RETRIEVAL_K } from '../../src/config/constants.js';
import { knowledgeSearchTool } from '../../src/modules/tools/definitions/knowledge_search.js';
import { registerTool, ToolRegistry } from '../../src/modules/tools/registry.js';
import { toolRegistry } from '../../src/modules/tools/index.js';
import { makeContext } from '../fixtures/seed.js';

// Always-on core tools + the flag-gated native Telegram toolkit (6 tools, all internal-audience).
// Core = 7 originals + 8 servercrm client-service / UI tools (crm.pick_my_client, crm.list_my_clients,
// crm.carrier_balance/overview, crm.list_cards, crm.transactions, crm.payment_info, ui.request_choice).
const CORE_TOOL_COUNT = 15;
const TELEGRAM_TOOL_COUNT = env.FF_TELEGRAM_ENABLED ? 6 : 0;
const INTERNAL_TOOL_COUNT = CORE_TOOL_COUNT + TELEGRAM_TOOL_COUNT;

describe('tool registry', () => {
  it('registers the core tools + flag-gated toolkits with unique names', () => {
    const names = toolRegistry.all().map((t) => t.name);
    expect(names).toHaveLength(INTERNAL_TOOL_COUNT);
    expect(new Set(names).size).toBe(INTERNAL_TOOL_COUNT);
    expect(names).toContain('knowledge.search');
    expect(names).toContain('zoho_people.search_employees');
    expect(names).toContain('zoho_crm.query');
    expect(names).toContain('zoho_desk.search_tickets');
    expect(names).toContain('agent.sales_snapshot');
    if (env.FF_TELEGRAM_ENABLED) {
      expect(names).toContain('telegram.send_message');
      expect(names).toContain('telegram.get_me');
    }
  });

  it('rejects duplicate tool names', () => {
    const tool = toolRegistry.all()[0]!;
    expect(() => new ToolRegistry([tool, tool])).toThrow(/Duplicate/);
  });

  it('filters tools by audience + scopes + department for each role', () => {
    // admin → allDepartmentAccess + admin role → sees every internal tool (core + Telegram sends/reads).
    expect(toolRegistry.listForContext(makeContext({ role: 'admin', audience: 'internal' }))).toHaveLength(
      INTERNAL_TOOL_COUNT,
    );
    // Telegram tools are internal-only, so a partner admin still sees just the one partner-visible tool.
    expect(toolRegistry.listForContext(makeContext({ role: 'admin', audience: 'partner' }))).toHaveLength(1);
    // Non-admin roles in the fixture have NO departments, so department-gated tools (zoho_crm.query,
    // agent.*, zoho_desk) are now withheld — they see only the universal knowledge.search.
    expect(toolRegistry.listForContext(makeContext({ role: 'viewer' }))).toHaveLength(1);
    expect(toolRegistry.listForContext(makeContext({ role: 'ops' }))).toHaveLength(1);
    expect(toolRegistry.listForContext(makeContext({ role: 'driver' }))).toHaveLength(1);
  });
});

describe('registerTool', () => {
  it('applies input schema defaults', () => {
    const parsed = knowledgeSearchTool.inputSchema.parse({ query: 'hello' });
    expect(parsed).toMatchObject({ query: 'hello', limit: DEFAULT_RETRIEVAL_K });
  });

  it('validates handler output against the output schema', async () => {
    const tool = registerTool({
      name: 'test.bad_output',
      description: 'returns an invalid shape on purpose',
      inputSchema: z.object({}),
      outputSchema: z.object({ value: z.number() }),
      riskClass: 'read',
      allowedAudiences: ['internal'],
      requiredScopes: [],
      handler: async () => ({ value: 'not-a-number' as unknown as number }),
    });
    await expect(tool.run({}, makeContext())).rejects.toBeTruthy();
  });

  it('bypassRbac short-circuits every access gate (BYPASS_USERS)', () => {
    // A tool that a normal context fails on every axis: wrong audience, missing scope, write-risk.
    const lockedTool = registerTool({
      name: 'test.locked',
      description: 'fails audience + scope + write gates',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      riskClass: 'write',
      allowedAudiences: ['partner'],
      requiredScopes: ['nonexistent:scope'],
      handler: async () => ({}),
    });
    const registry = new ToolRegistry([lockedTool]);
    const normal = makeContext({ role: 'viewer', audience: 'internal' });
    expect(registry.checkAccess(lockedTool, normal).ok).toBe(false);
    expect(registry.checkAccess(lockedTool, { ...normal, bypassRbac: true }).ok).toBe(true);
  });

  it('enforces admin-only for write-risk tools', () => {
    const writeTool = registerTool({
      name: 'test.write',
      description: 'a write tool',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      riskClass: 'write',
      allowedAudiences: ['internal'],
      requiredScopes: [],
      handler: async () => ({}),
    });
    const registry = new ToolRegistry([writeTool]);
    expect(registry.checkAccess(writeTool, makeContext({ role: 'ops' })).ok).toBe(false);
    expect(registry.checkAccess(writeTool, makeContext({ role: 'admin' })).ok).toBe(true);
  });
});
