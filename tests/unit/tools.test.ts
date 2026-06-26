import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_RETRIEVAL_K } from '../../src/config/constants.js';
import { knowledgeSearchTool } from '../../src/modules/tools/definitions/knowledge_search.js';
import { registerTool, ToolRegistry } from '../../src/modules/tools/registry.js';
import { toolRegistry } from '../../src/modules/tools/index.js';
import { makeContext } from '../fixtures/seed.js';

describe('tool registry', () => {
  it('registers all 7 tools with unique names', () => {
    const names = toolRegistry.all().map((t) => t.name);
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(7);
    expect(names).toContain('knowledge.search');
    expect(names).toContain('zoho_people.search_employees');
    expect(names).toContain('zoho_crm.query');
    expect(names).toContain('zoho_desk.search_tickets');
    expect(names).toContain('agent.sales_snapshot');
  });

  it('rejects duplicate tool names', () => {
    const tool = toolRegistry.all()[0]!;
    expect(() => new ToolRegistry([tool, tool])).toThrow(/Duplicate/);
  });

  it('filters tools by audience + scopes + department for each role', () => {
    // admin → allDepartmentAccess → bypasses dept gating → all 7 internal tools.
    expect(toolRegistry.listForContext(makeContext({ role: 'admin', audience: 'internal' }))).toHaveLength(7);
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
