import { describe, expect, it } from 'vitest';
import { AgentRegistry, agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import { ALL_AGENT_MANIFESTS } from '../../src/modules/agents/manifests/index.js';
import { AGENT_KEYS } from '../../src/modules/agents/types.js';
import { makeContext } from '../fixtures/seed.js';

const dept = (departments: string[]) =>
  makeContext({ role: 'ops', audience: 'internal', departments, allDepartmentAccess: false });

const keys = (ctx: ReturnType<typeof dept>) =>
  agentRegistry.listForContext(ctx).map((m) => m.key).sort();

describe('agent manifests', () => {
  it('registers all agents exactly once', () => {
    expect(ALL_AGENT_MANIFESTS.map((m) => m.key).sort()).toEqual([...AGENT_KEYS].sort());
    expect(agentRegistry.all()).toHaveLength(AGENT_KEYS.length);
  });

  it('rejects duplicate keys', () => {
    const m = ALL_AGENT_MANIFESTS[0]!;
    expect(() => new AgentRegistry([m, m])).toThrow(/duplicate/i);
  });
});

describe('agent selection RBAC (checkAccess / listForContext)', () => {
  it('sales caller may select only agents granting sales (data-center + sales + marketing)', () => {
    expect(keys(dept(['sales']))).toEqual(['data-center', 'marketing', 'sales']);
  });

  it('billing caller may select only the billing agent', () => {
    expect(keys(dept(['billing']))).toEqual(['billing']);
  });

  it('management caller may select only the manager agent', () => {
    expect(keys(dept(['management']))).toEqual(['manager']);
  });

  it('no-department caller may select nothing', () => {
    expect(keys(dept([]))).toEqual([]);
  });

  it('analyst is reserved for allDepartmentAccess callers', () => {
    const analyst = agentRegistry.get('analyst')!;
    const denied = agentRegistry.checkAccess(analyst, dept(['sales', 'billing', 'finance']));
    expect(denied.ok).toBe(false);
    expect(denied.reason).toMatch(/all-department/i);
  });

  it('allDepartmentAccess caller may select every agent', () => {
    const admin = makeContext({ allDepartmentAccess: true });
    expect(keys(admin)).toEqual([...AGENT_KEYS].sort());
  });

  it('partner audience is denied every agent (all internal-only)', () => {
    const partner = makeContext({
      role: 'driver',
      audience: 'partner',
      departments: ['sales'],
      allDepartmentAccess: false,
    });
    expect(keys(partner)).toEqual([]);
    const check = agentRegistry.checkAccess(agentRegistry.get('sales')!, partner);
    expect(check.reason).toMatch(/audience/);
  });

  it('customer audience is denied every agent until explicitly opted in', () => {
    const customer = makeContext({
      role: 'viewer',
      audience: 'customer',
      departments: ['5758544'],
      allDepartmentAccess: false,
    });
    expect(keys(customer)).toEqual([]);
  });

  it('bypassRbac short-circuits the audience + department gates', () => {
    const bypass = makeContext({
      role: 'viewer',
      audience: 'partner',
      departments: [],
      allDepartmentAccess: false,
      bypassRbac: true,
    });
    expect(keys(bypass)).toEqual([...AGENT_KEYS].sort());
  });
});
