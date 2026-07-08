import { describe, expect, it } from 'vitest';
import { narrowContext, narrowRagScope } from '../../src/modules/agents/authority.js';
import { agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import { ALL_AGENT_MANIFESTS } from '../../src/modules/agents/manifests/index.js';
import { normalizeDepartments } from '../../src/lib/department.js';
import { makeContext } from '../fixtures/seed.js';

const salesCaller = () =>
  makeContext({
    role: 'ops',
    audience: 'internal',
    departments: ['sales'],
    allDepartmentAccess: false,
    bypassRbac: true, // deliberately hostile: must never survive narrowing
  });

describe('narrowContext invariants (table-driven over all 10 manifests)', () => {
  for (const manifest of ALL_AGENT_MANIFESTS) {
    it(`${manifest.key}: never widens a regular caller`, () => {
      const ctx = salesCaller();
      const narrowed = narrowContext(ctx, manifest);
      // departments ⊆ caller's departments
      for (const d of narrowed.departments) expect(ctx.departments).toContain(d);
      expect(narrowed.allDepartmentAccess).toBe(false);
      expect(narrowed.bypassRbac).toBeUndefined();
      expect(narrowed.actingAgent).toBe(manifest.key);
      // identity/tenant unchanged
      expect(narrowed.tenantId).toBe(ctx.tenantId);
      expect(narrowed.userId).toBe(ctx.userId);
    });

    it(`${manifest.key}: admin caller is bounded to the operating list, bypass dropped`, () => {
      const admin = makeContext({ allDepartmentAccess: true, bypassRbac: true });
      const narrowed = narrowContext(admin, manifest);
      const operating = normalizeDepartments(manifest.operatingDepartments ?? manifest.departments);
      expect(narrowed.departments).toEqual(operating);
      expect(narrowed.allDepartmentAccess).toBe(false);
      expect(narrowed.bypassRbac).toBeUndefined();
    });
  }

  it('does not mutate the caller context', () => {
    const ctx = salesCaller();
    narrowContext(ctx, agentRegistry.get('billing')!);
    expect(ctx.departments).toEqual(['sales']);
    expect(ctx.bypassRbac).toBe(true);
    expect(ctx.actingAgent).toBeUndefined();
  });
});

describe('narrowRagScope', () => {
  it('never widens a regular caller (all manifests)', () => {
    const ctx = makeContext({
      role: 'ops',
      departments: ['sales', 'billing'],
      allDepartmentAccess: false,
    });
    for (const manifest of ALL_AGENT_MANIFESTS) {
      const scope = narrowRagScope(ctx, manifest);
      expect(scope.allDepartmentAccess).toBe(false);
      for (const d of scope.departments) expect(ctx.departments).toContain(d);
    }
  });

  it('billing caller + billing agent → own department only (cap intersects)', () => {
    const ctx = makeContext({ role: 'ops', departments: ['billing'], allDepartmentAccess: false });
    expect(narrowRagScope(ctx, agentRegistry.get('billing')!)).toEqual({
      departments: ['billing'],
      allDepartmentAccess: false,
    });
  });

  it('admin + billing agent → the agent cap (billing + finance), not everything', () => {
    const admin = makeContext({ allDepartmentAccess: true });
    const scope = narrowRagScope(admin, agentRegistry.get('billing')!);
    expect(scope.allDepartmentAccess).toBe(false);
    expect(scope.departments.sort()).toEqual(['billing', 'finance']);
  });

  it('admin + analyst (allowAllDepartments) → unfiltered retrieval', () => {
    const admin = makeContext({ allDepartmentAccess: true });
    expect(narrowRagScope(admin, agentRegistry.get('analyst')!).allDepartmentAccess).toBe(true);
  });

  it('non-admin management caller + manager → own departments, no bypass', () => {
    const ctx = makeContext({ role: 'ops', departments: ['management'], allDepartmentAccess: false });
    expect(narrowRagScope(ctx, agentRegistry.get('manager')!)).toEqual({
      departments: ['management'],
      allDepartmentAccess: false,
    });
  });
});
