import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { env } from '../../src/config/env.js';
import {
  isAdministratorProfile,
  normalizeDepartment,
  normalizeDepartments,
  resolveAllDepartmentAccess,
} from '../../src/lib/department.js';
import { knowledgeRepo } from '../../src/repos/knowledgeRepo.js';
import { registerTool, ToolRegistry } from '../../src/modules/tools/registry.js';
import type { ToolManifest } from '../../src/modules/tools/types.js';
import { withDepartmentAccess } from '../../src/routes/v1/helpers.js';
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

describe('withDepartmentAccess — session-authoritative vs legacy header trust', () => {
  /** Fake just what withDepartmentAccess touches: headers + log.warn. */
  function fakeRequest(headers: Record<string, string> = {}) {
    const warn = vi.fn();
    return { req: { headers, log: { warn } } as unknown as FastifyRequest, warn };
  }

  it('verified worker: elevation headers are ignored; departments derive from the profile', () => {
    const ctx = makeContext({
      role: 'worker',
      departments: [],
      allDepartmentAccess: false,
      sessionVerified: true,
      profiles: ['Sales Rep'],
    });
    const { req, warn } = fakeRequest({
      'x-department-access': 'retention,finance',
      'x-all-departments': 'true',
    });
    const out = withDepartmentAccess(ctx, req);
    expect(out.allDepartmentAccess).toBe(false);
    expect(out.departments).toEqual(['sales']);
    expect(warn).toHaveBeenCalledOnce(); // ungranted claims logged (roster signal)
  });

  it('verified worker: body departmentAccess cannot widen either', () => {
    const ctx = makeContext({
      role: 'worker',
      departments: [],
      allDepartmentAccess: false,
      sessionVerified: true,
      profiles: ['Retention Specialist'],
    });
    const { req } = fakeRequest();
    const out = withDepartmentAccess(ctx, req, { departmentAccess: ['finance'], allDepartments: true });
    expect(out.allDepartmentAccess).toBe(false);
    expect(out.departments).toEqual(['retention']);
  });

  it('verified admin: returned unchanged (allDepartmentAccess already token-derived)', () => {
    const ctx = makeContext({
      role: 'admin',
      departments: [],
      allDepartmentAccess: true,
      sessionVerified: true,
    });
    const { req } = fakeRequest({ 'x-department-access': 'sales' });
    expect(withDepartmentAccess(ctx, req)).toBe(ctx);
  });

  it('verified customer: returned unchanged, headers never consulted', () => {
    const ctx = makeContext({
      role: 'viewer',
      audience: 'customer',
      departments: ['company:acme'],
      allDepartmentAccess: false,
      sessionVerified: true,
    });
    const { req } = fakeRequest({ 'x-all-departments': 'true' });
    expect(withDepartmentAccess(ctx, req)).toBe(ctx);
  });

  it('unverified (API-key/server-to-server): legacy header trust preserved', () => {
    const ctx = makeContext({ role: 'ops', departments: ['billing'], allDepartmentAccess: false });
    const { req } = fakeRequest({ 'x-department-access': 'sales', 'x-all-departments': 'true' });
    const out = withDepartmentAccess(ctx, req);
    expect(out.departments).toEqual(expect.arrayContaining(['billing', 'sales']));
    expect(out.allDepartmentAccess).toBe(true);
  });

  it('FF_SESSION_DEPT_AUTHORITATIVE=0 rolls a verified session back to header trust', () => {
    const saved = env.FF_SESSION_DEPT_AUTHORITATIVE;
    env.FF_SESSION_DEPT_AUTHORITATIVE = false;
    try {
      const ctx = makeContext({
        role: 'worker',
        departments: [],
        allDepartmentAccess: false,
        sessionVerified: true,
      });
      const { req } = fakeRequest({ 'x-all-departments': 'true' });
      expect(withDepartmentAccess(ctx, req).allDepartmentAccess).toBe(true);
    } finally {
      env.FF_SESSION_DEPT_AUTHORITATIVE = saved;
    }
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
