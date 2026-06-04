import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { knowledgeRepo } from '../../src/repos/knowledgeRepo.js';
import { registerTool, ToolRegistry } from '../../src/modules/tools/registry.js';
import type { ToolManifest } from '../../src/modules/tools/types.js';
import { makeContext } from '../fixtures/seed.js';

/** A minimal read tool with no scope/audience constraints, gated only by department. */
function deptTool(allowedDepartments?: string[]) {
  const manifest: ToolManifest<Record<string, never>, { ok: true }> = {
    name: 'test.dept_tool',
    description: 'test',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.literal(true) }),
    riskClass: 'read',
    allowedAudiences: ['internal', 'partner'],
    requiredScopes: [],
    ...(allowedDepartments ? { allowedDepartments } : {}),
    handler: async () => ({ ok: true }),
  };
  return new ToolRegistry([registerTool(manifest)]);
}

describe('department RBAC — tool gating', () => {
  const tool = (r: ToolRegistry) => r.all()[0]!;

  it('allows any department when the tool is not department-restricted', () => {
    const r = deptTool();
    expect(r.checkAccess(tool(r), makeContext({ role: 'viewer', departments: [] })).ok).toBe(true);
  });

  it('denies a non-manager without an overlapping department', () => {
    const r = deptTool(['sales']);
    const check = r.checkAccess(tool(r), makeContext({ role: 'viewer', departments: ['billing'] }));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('sales');
  });

  it('allows a non-manager with an overlapping department', () => {
    const r = deptTool(['sales', 'billing']);
    expect(r.checkAccess(tool(r), makeContext({ role: 'viewer', departments: ['billing'] })).ok).toBe(true);
  });

  it('allows managers (allDepartmentAccess) regardless of department', () => {
    const r = deptTool(['sales']);
    // admin -> allDepartmentAccess true by default
    expect(r.checkAccess(tool(r), makeContext({ role: 'admin', departments: [] })).ok).toBe(true);
  });
});

describe('department RBAC — retrieval SQL filter', () => {
  it('filters by department for a non-manager with departments', () => {
    const ctx = makeContext({ role: 'ops', departments: ['sales'] });
    const { sql, params } = knowledgeRepo.buildSearchQuery(ctx, [0.1, 0.2, 0.3], 5).toSQL();
    expect(sql).toContain('department_access');
    expect(params).toContain('sales');
  });

  it('restricts a non-manager with no departments to global (NULL) only', () => {
    const ctx = makeContext({ role: 'ops', departments: [] });
    const { sql } = knowledgeRepo.buildSearchQuery(ctx, [0.1, 0.2, 0.3], 5).toSQL();
    expect(sql).toContain('department_access');
    expect(sql.toLowerCase()).toContain('is null');
  });

  it('applies no department filter for managers (allDepartmentAccess)', () => {
    const ctx = makeContext({ role: 'admin' }); // allDepartmentAccess true
    const { sql } = knowledgeRepo.buildSearchQuery(ctx, [0.1, 0.2, 0.3], 5).toSQL();
    expect(sql).not.toContain('department_access');
  });
});
