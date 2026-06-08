import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  isAdministratorProfile,
  normalizeDepartment,
  normalizeDepartments,
  resolveAllDepartmentAccess,
} from '../../src/lib/department.js';
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

describe('department normalization (ingest + query must not drift)', () => {
  it('trims + lowercases a tag; blank => null (Global)', () => {
    expect(normalizeDepartment('  Finance ')).toBe('finance');
    expect(normalizeDepartment('C-Level')).toBe('c-level');
    expect(normalizeDepartment('')).toBeNull();
    expect(normalizeDepartment('   ')).toBeNull();
    expect(normalizeDepartment(undefined)).toBeNull();
    expect(normalizeDepartment(null)).toBeNull();
  });

  it('normalizes + dedupes a list, dropping blanks', () => {
    expect(normalizeDepartments([' Finance', 'finance', 'C-LEVEL', '', '  '])).toEqual([
      'finance',
      'c-level',
    ]);
    expect(normalizeDepartments(undefined)).toEqual([]);
  });
});

describe('Administrator profile bypass (RAG + tools share one flag)', () => {
  it('detects an Administrator profile (case-insensitive, substring, list or string)', () => {
    expect(isAdministratorProfile('Administrator')).toBe(true);
    expect(isAdministratorProfile('System Administrator')).toBe(true);
    expect(isAdministratorProfile(['Standard', 'administrator'])).toBe(true);
    expect(isAdministratorProfile('Standard')).toBe(false);
    expect(isAdministratorProfile(undefined)).toBe(false);
    expect(isAdministratorProfile([])).toBe(false);
  });

  it('resolves the bypass from allDepartments OR an Administrator profile', () => {
    expect(resolveAllDepartmentAccess({ allDepartments: true })).toBe(true);
    expect(resolveAllDepartmentAccess({ profile: 'Administrator' })).toBe(true);
    expect(resolveAllDepartmentAccess({ profile: ['Standard'] })).toBe(false);
    expect(resolveAllDepartmentAccess({})).toBe(false);
  });

  it('the bypass flag unlocks both a dept-restricted tool and unfiltered retrieval', () => {
    // tools
    const r = deptTool(['finance']);
    const adminCtx = makeContext({ role: 'viewer', departments: [], allDepartmentAccess: true });
    expect(r.checkAccess(r.all()[0]!, adminCtx).ok).toBe(true);
    // retrieval
    const { sql } = knowledgeRepo.buildSearchQuery(adminCtx, [0.1, 0.2, 0.3], 5).toSQL();
    expect(sql).not.toContain('department_access');
  });
});

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
