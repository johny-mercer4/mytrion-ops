import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_RETRIEVAL_K } from '../../src/config/constants.js';
import { knowledgeSearchTool } from '../../src/modules/tools/definitions/knowledge_search.js';
import { registerTool, ToolRegistry } from '../../src/modules/tools/registry.js';
import { toolRegistry } from '../../src/modules/tools/index.js';
import { makeContext } from '../fixtures/seed.js';

describe('tool registry', () => {
  it('registers all 5 tools with unique names', () => {
    const names = toolRegistry.all().map((t) => t.name);
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    expect(names).toContain('knowledge.search');
    expect(names).toContain('zoho_people.search_employees');
    expect(names).toContain('agent.sales_snapshot');
  });

  it('rejects duplicate tool names', () => {
    const tool = toolRegistry.all()[0]!;
    expect(() => new ToolRegistry([tool, tool])).toThrow(/Duplicate/);
  });

  it('filters tools by audience + scopes for each role', () => {
    // admin holds '*' → sees all 5 internal tools. Others only see knowledge.search (no scope
    // required, both audiences); zoho_people + agent.* need scopes the non-admin roles lack.
    expect(toolRegistry.listForContext(makeContext({ role: 'admin', audience: 'internal' }))).toHaveLength(5);
    expect(toolRegistry.listForContext(makeContext({ role: 'admin', audience: 'partner' }))).toHaveLength(1);
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
