/**
 * Sales Mytrion go-live contract — the exact isolation promise, pinned:
 * a Sales-agent-profile worker resolves to ['sales'] with home 'sales', is NEVER an admin
 * (even with "Manager" in their Zoho role — the substring regression), and is denied other
 * departments' direct routes, agents, and touchpoints server-side. Plus: profile-default
 * seeding is idempotent, every catalog entry declares departments, and a single-Mytrion
 * grant always resolves a home.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/mytrionProfileDefaultsRepo.js', () => ({
  mytrionProfileDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/workerMytrionAccessRepo.js', () => ({
  workerMytrionAccessRepo: { findByZohoUserId: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));

import type { FastifyRequest } from 'fastify';
import { RBACError } from '../../src/lib/errors.js';
import { resolveAllDepartmentAccess } from '../../src/lib/department.js';
import { DEFAULT_PROFILE_SEED, profileKeyOf } from '../../src/lib/mytrions.js';
import { agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { workerRoleFor } from '../../src/modules/auth/workerRole.js';
import { canInvokeTouchpoint } from '../../src/modules/touchpoints/dispatcher.js';
import { getTouchpoint, listTouchpoints } from '../../src/modules/touchpoints/catalog/index.js';
import { mytrionProfileDefaultsRepo } from '../../src/repos/mytrionProfileDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../src/repos/workerMytrionAccessRepo.js';
import { requireDepartment } from '../../src/routes/v1/helpers.js';
import type { TenantContext } from '../../src/types/tenantContext.js';
import { makeContext } from '../fixtures/seed.js';

const pd = vi.mocked(mytrionProfileDefaultsRepo);
const wa = vi.mocked(workerMytrionAccessRepo);

let seq = 0;
/** Unique principal per assertion — dodges the resolver's 60s TTL cache. */
function principal(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    tenantId: 'octane',
    zohoUserId: `golive-u${seq}`,
    profileName: null,
    zohoRole: null,
    userName: null,
    ...overrides,
  };
}

function seedRow(profileName: string) {
  const seed = DEFAULT_PROFILE_SEED.find((s) => s.profileName === profileName);
  if (!seed) throw new Error(`no seed for ${profileName}`);
  return {
    id: `pd_${profileKeyOf(profileName)}`,
    profileName: seed.profileName,
    profileKey: profileKeyOf(seed.profileName),
    allowedMytrions: seed.allowedMytrions,
    homeMytrion: seed.homeMytrion,
    allDepartmentAccess: seed.allDepartmentAccess,
    active: true,
    createdAt: '',
    updatedAt: '',
  };
}

/** The seeded resolver world: findByKey serves DEFAULT_PROFILE_SEED rows. */
function mockSeeded() {
  pd.findByKey.mockImplementation(async (_ctx: unknown, key: unknown) => {
    const seed = DEFAULT_PROFILE_SEED.find((s) => profileKeyOf(s.profileName) === key);
    return seed ? seedRow(seed.profileName) : undefined;
  });
}

function salesCtx(): TenantContext {
  return makeContext({
    role: 'worker',
    userId: 'zoho:6227679000000112233',
    userName: 'Daniel Brown',
    audience: 'internal',
    departments: ['sales'],
    allDepartmentAccess: false,
    sessionVerified: true,
  });
}

function fakeRequest(ctx: TenantContext): FastifyRequest {
  return {
    ctx,
    headers: {},
    log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  } as unknown as FastifyRequest;
}

beforeEach(() => {
  mytrionAccessService.invalidateAll();
  pd.findByKey.mockReset().mockResolvedValue(undefined);
  pd.list.mockReset().mockResolvedValue([]);
  pd.upsert.mockReset().mockImplementation(async (_ctx: unknown, row: { profileName: string }) => seedRow(row.profileName));
  wa.findByZohoUserId.mockReset().mockResolvedValue(undefined);
});

describe('profile-default seeding (boot + admin GET share ensureProfileDefaultsSeeded)', () => {
  it('seeds every DEFAULT_PROFILE_SEED profile into an empty tenant, once', async () => {
    pd.list
      .mockResolvedValueOnce([]) // pre-check: empty tenant
      .mockResolvedValue(DEFAULT_PROFILE_SEED.map((s) => seedRow(s.profileName)));
    const out = await mytrionAccessService.ensureProfileDefaultsSeeded('octane');
    expect(pd.upsert).toHaveBeenCalledTimes(DEFAULT_PROFILE_SEED.length);
    expect(out.length).toBe(DEFAULT_PROFILE_SEED.length);
  });

  it('is a no-op for a tenant that already has rows (admin edits never clobbered)', async () => {
    pd.list.mockResolvedValue([seedRow('Sales Agent')]);
    const out = await mytrionAccessService.ensureProfileDefaultsSeeded('octane');
    expect(pd.upsert).not.toHaveBeenCalled();
    expect(out.length).toBe(1);
  });
});

describe('seeded per-profile resolution (the landing contract)', () => {
  it.each([
    ['Sales Agent', ['sales'], 'sales'],
    ['Sales Plus', ['sales'], 'sales'],
    ['Sales Assistant', ['sales'], 'sales'],
    ['Referral Standard Plus', ['sales'], 'sales'],
  ])('%s → sales only, home sales, not admin', async (profileName, mytrions, home) => {
    mockSeeded();
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName }));
    expect(r.accessibleMytrions).toEqual(mytrions);
    expect(r.homeMytrion).toBe(home);
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.departments).toEqual(['sales']);
  });

  it('Standard Plus → sales + billing, home sales', async () => {
    mockSeeded();
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard Plus' }));
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'sales']);
    expect(r.homeMytrion).toBe('sales');
  });

  it('Standard → no Mytrions (CS is Admin-grant only)', async () => {
    mockSeeded();
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));
    expect(r.accessibleMytrions).toEqual([]);
    expect(r.homeMytrion).toBeNull();
  });

  it('Customer Retention → customer-service', async () => {
    mockSeeded();
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Customer Retention' }),
    );
    expect(r.accessibleMytrions).toEqual(['customer-service']);
    expect(r.homeMytrion).toBe('customer-service');
  });
});

describe('admin-marker regression (the go-live killer)', () => {
  it('a Sales Agent with a "Sales Manager" role is NOT an admin', async () => {
    expect(resolveAllDepartmentAccess({ profile: 'Sales Agent', role: 'Sales Manager' })).toBe(false);
    expect(workerRoleFor({ profile: 'Sales Agent', zohoRole: 'Sales Manager' })).toBe('worker');
    mockSeeded();
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Sales Agent', zohoRole: 'Sales Manager' }),
    );
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.accessibleMytrions).toEqual(['sales']);
  });

  it('positive controls: Administrator profile and CEO role stay admin; near-misses do not', () => {
    expect(resolveAllDepartmentAccess({ profile: 'Administrator' })).toBe(true);
    expect(resolveAllDepartmentAccess({ role: 'CEO' })).toBe(true);
    expect(resolveAllDepartmentAccess({ profile: 'System Administrator' })).toBe(false);
    expect(resolveAllDepartmentAccess({ role: 'Developer' })).toBe(false);
  });
});

describe('server-side denials for a sales session', () => {
  it('requireDepartment: billing throws RBAC, sales passes', () => {
    const ctx = salesCtx();
    expect(() => requireDepartment(fakeRequest(ctx), 'billing', 'X')).toThrow(RBACError);
    expect(() => requireDepartment(fakeRequest(ctx), 'sales', 'X')).not.toThrow();
  });

  it('agent registry: billing/finance agents denied, sales agent allowed', () => {
    const ctx = salesCtx();
    const billing = agentRegistry.get('billing');
    const finance = agentRegistry.get('finance');
    const sales = agentRegistry.get('sales');
    expect(billing && agentRegistry.checkAccess(billing, ctx).ok).toBe(false);
    expect(finance && agentRegistry.checkAccess(finance, ctx).ok).toBe(false);
    expect(sales && agentRegistry.checkAccess(sales, ctx).ok).toBe(true);
  });

  it('touchpoints: finance/billing keys denied, a sales key allowed', () => {
    const ctx = salesCtx();
    const finance = getTouchpoint('finance.client_invoices');
    const salesTp = getTouchpoint('dashboard.company');
    expect(finance).toBeDefined();
    expect(salesTp).toBeDefined();
    expect(canInvokeTouchpoint(ctx, finance!)).toBe(false);
    expect(canInvokeTouchpoint(ctx, salesTp!)).toBe(true);
    const billing = listTouchpoints().filter((tp) => tp.departments.includes('billing') && !tp.departments.includes('sales'));
    expect(billing.length).toBeGreaterThan(0);
    for (const tp of billing) expect(canInvokeTouchpoint(ctx, tp)).toBe(false);
  });

  it('catalog audit: EVERY touchpoint declares a non-empty departments list', () => {
    const all = listTouchpoints();
    expect(all.length).toBeGreaterThan(50);
    for (const tp of all) {
      expect(Array.isArray(tp.departments) && tp.departments.length >= 1, `${tp.key} must declare departments`).toBe(true);
    }
  });
});

describe('homeMytrion invariant', () => {
  it('an override replacing access with a single Mytrion resolves that Mytrion as home', async () => {
    mockSeeded();
    wa.findByZohoUserId.mockResolvedValue({
      id: 'wma_1',
      zohoUserId: 'x',
      userName: null,
      email: null,
      profileName: null,
      allowedMytrions: ['billing'],
      deniedMytrions: [],
      homeMytrion: null,
      allDepartmentAccess: null,
      viewAsUserIds: [],
      active: true,
      createdAt: '',
      updatedAt: '',
    });
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Sales Agent' }));
    expect(r.accessibleMytrions).toEqual(['billing']);
    expect(r.homeMytrion).toBe('billing'); // pickHome: sole accessible wins
  });
});
