/**
 * Referral bonus ledger — cross-tenant leakage guard (CLAUDE.md rule 9) + the declarative bonus
 * spec.
 *
 * The repo is the ONLY isolation boundary for `mytrion_referral_bonuses` (no DB foreign keys, no
 * row-level security), so these tests render the SQL that drizzle actually builds and assert that
 * every read and every write is bound to `ctx.tenantId`. A method that forgets the tenant filter
 * would leak one tenant's payout ledger into another's export — money, not just data.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedCall {
  method: string;
  args: unknown[];
}

let calls: RecordedCall[] = [];
let resultRows: unknown[] = [];

/**
 * A chainable stand-in for the drizzle query builder: every method records its arguments and
 * returns the same object, and the object is thenable so `await db.select()...` resolves. This lets
 * us inspect the real `SQL` condition objects the repo passes to `.where()`.
 */
function makeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const method of [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'groupBy',
    'insert',
    'values',
    'onConflictDoUpdate',
    'returning',
    'update',
    'set',
    'delete',
  ]) {
    builder[method] = record(method);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resultRows).then(resolve);
  return builder;
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import { referralBonusRepo } from '../../src/repos/referralBonusRepo.js';
import {
  REFERRAL_BONUS_SPECS,
  REFERRAL_BONUS_SPEC_BY_TYPE,
  bonusTypesForCalculation,
  isOneTimeBonusType,
} from '../../src/modules/manager/referralBonusTypes.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const dialect = new PgDialect();

const ctx = (tenantId: string): TenantContext =>
  ({ tenantId, userId: 'u_1', role: 'admin', scopes: ['*'], audience: 'internal' }) as TenantContext;

const ACME = ctx('tenant_acme');
const RIVAL = ctx('tenant_rival');

/** Render every condition the repo handed to `.where()` into real SQL text + bound params. */
function renderedWheres(): Array<{ sql: string; params: unknown[] }> {
  return calls
    .filter((c) => c.method === 'where')
    .map((c) => {
      const query = dialect.sqlToQuery(c.args[0] as never);
      return { sql: query.sql, params: query.params as unknown[] };
    });
}

/** Values passed to `.values()` / `.set()` — used to prove the tenant is stamped, not accepted. */
function writtenPayloads(): Array<Record<string, unknown>> {
  return calls
    .filter((c) => c.method === 'values' || c.method === 'set')
    .map((c) => c.args[0] as Record<string, unknown>);
}

beforeEach(() => {
  calls = [];
  resultRows = [];
});

const BONUS_ROW = {
  bonusType: 'gallons_legacy' as const,
  periodMonth: '2026-06-01',
  childReferralId: '6227679000194765075',
  resolution: 'carrier_id' as const,
  recipientKind: 'parent' as const,
  amountUsd: '15.50',
};

describe('every ledger read is bound to the caller tenant', () => {
  const reads: Array<[string, (t: TenantContext) => Promise<unknown>]> = [
    ['list', (t) => referralBonusRepo.list(t)],
    ['list (filtered)', (t) => referralBonusRepo.list(t, { periodMonth: '2026-06-01', bonusType: 'swipes_legacy' })],
    ['totals', (t) => referralBonusRepo.totals(t, '2026-06-01')],
    ['listRuns', (t) => referralBonusRepo.listRuns(t)],
  ];

  for (const [name, run] of reads) {
    it(`${name} filters on tenant_id and binds only the caller's tenant`, async () => {
      await run(ACME);
      const wheres = renderedWheres();
      expect(wheres.length).toBeGreaterThan(0);
      for (const w of wheres) {
        expect(w.sql).toContain('"tenant_id"');
        expect(w.params).toContain('tenant_acme');
        expect(w.params).not.toContain('tenant_rival');
      }
    });
  }

  it('the same call from another tenant binds that tenant instead — no shared state', async () => {
    await referralBonusRepo.list(ACME);
    const acme = renderedWheres();
    calls = [];
    await referralBonusRepo.list(RIVAL);
    const rival = renderedWheres();

    expect(acme.every((w) => w.params.includes('tenant_acme'))).toBe(true);
    expect(rival.every((w) => w.params.includes('tenant_rival'))).toBe(true);
    expect(rival.some((w) => w.params.includes('tenant_acme'))).toBe(false);
  });
});

describe('every ledger write is bound to the caller tenant', () => {
  it('upsert stamps tenantId from the context (callers cannot supply one)', async () => {
    resultRows = [{ id: 'rb_1' }];
    await referralBonusRepo.upsert(ACME, BONUS_ROW);

    const inserted = writtenPayloads()[0];
    expect(inserted).toBeDefined();
    expect(inserted?.tenantId).toBe('tenant_acme');
    // The upsert input type has no tenantId field at all — this asserts the runtime matches.
    expect(Object.keys(BONUS_ROW)).not.toContain('tenantId');
  });

  it('upsert conflict target is scoped by tenant, so tenants cannot collide on one key', async () => {
    resultRows = [{ id: 'rb_1' }];
    await referralBonusRepo.upsert(ACME, BONUS_ROW);

    const conflict = calls.find((c) => c.method === 'onConflictDoUpdate');
    const target = (conflict?.args[0] as { target: Array<{ name: string }> }).target;
    expect(target.map((c) => c.name)).toEqual([
      'tenant_id',
      'child_referral_id',
      'bonus_type',
      'period_month',
    ]);
  });

  it('recalculation never overwrites a row where money already moved', async () => {
    resultRows = [{ id: 'rb_1' }];
    await referralBonusRepo.upsert(ACME, BONUS_ROW);

    const conflict = calls.find((c) => c.method === 'onConflictDoUpdate');
    const setWhere = (conflict?.args[0] as { setWhere?: unknown }).setWhere;
    expect(setWhere).toBeDefined();
    const rendered = dialect.sqlToQuery(setWhere as never);
    expect(rendered.sql).toContain('"status"');
    // Only 'calculated' rows are refreshable — approved / paid / void are frozen.
    expect(rendered.params).toEqual(['calculated']);
  });

  it('upsert does not carry status in the update set (a paid row keeps its status)', async () => {
    resultRows = [{ id: 'rb_1' }];
    await referralBonusRepo.upsert(ACME, BONUS_ROW);

    const conflict = calls.find((c) => c.method === 'onConflictDoUpdate');
    const set = (conflict?.args[0] as { set: Record<string, unknown> }).set;
    expect(Object.keys(set)).not.toContain('status');
    expect(Object.keys(set)).toContain('amountUsd');
  });

  const writes: Array<[string, (t: TenantContext) => Promise<unknown>]> = [
    ['setStatus', (t) => referralBonusRepo.setStatus(t, ['rb_1'], 'paid')],
    ['deleteForRun', (t) => referralBonusRepo.deleteForRun(t, 'rbr_1')],
    ['finishRun', (t) => referralBonusRepo.finishRun(t, 'rbr_1', { status: 'succeeded' })],
  ];

  for (const [name, run] of writes) {
    it(`${name} cannot touch another tenant's rows`, async () => {
      await run(ACME);
      const wheres = renderedWheres();
      expect(wheres.length).toBeGreaterThan(0);
      for (const w of wheres) {
        expect(w.sql).toContain('"tenant_id"');
        expect(w.params).toContain('tenant_acme');
      }
    });
  }

  it('setStatus with no ids is a no-op that never reaches the database', async () => {
    const result = await referralBonusRepo.setStatus(ACME, [], 'paid');
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('startRun stamps the tenant on the run row', async () => {
    resultRows = [{ id: 'rbr_1' }];
    await referralBonusRepo.startRun(ACME, { periodMonth: '2026-06-01', trigger: 'scheduled' });
    expect(writtenPayloads()[0]?.tenantId).toBe('tenant_acme');
  });

  it('deleteForRun leaves approved/paid rows alone', async () => {
    await referralBonusRepo.deleteForRun(ACME, 'rbr_1');
    const rendered = renderedWheres()[0];
    expect(rendered?.params).toContain('calculated');
    expect(rendered?.params).not.toContain('paid');
  });
});

describe('bonus spec matches the calculation-types PDF', () => {
  it('defines exactly the four documented logics', () => {
    expect(REFERRAL_BONUS_SPECS.map((s) => s.type)).toEqual([
      'gallons_legacy',
      'swipes_legacy',
      'gallons_parent',
      'gallons_child',
    ]);
  });

  it('types 1-3 pay the parent; type 4 is the child exception', () => {
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_legacy.recipient).toBe('parent');
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.swipes_legacy.recipient).toBe('parent');
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_parent.recipient).toBe('parent');
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_child.recipient).toBe('child');
  });

  it('carries the documented rates and thresholds', () => {
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_legacy.rateUsd).toBe(0.01);
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.swipes_legacy.rateUsd).toBe(50);
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_parent.thresholdGallons).toBe(500);
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_child.thresholdGallons).toBe(1000);
    // Only the one-time types have a threshold.
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_legacy.thresholdGallons).toBeNull();
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.swipes_legacy.thresholdGallons).toBeNull();
  });

  it('applies the PDF fuel-code lists: legacy ULSD/ULSR, new logic adds DSL', () => {
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_legacy.fuelCodes).toEqual(['ULSD', 'ULSR']);
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.swipes_legacy.fuelCodes).toEqual(['ULSD', 'ULSR']);
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_parent.fuelCodes).toEqual(['ULSD', 'DSL', 'ULSR']);
    expect(REFERRAL_BONUS_SPEC_BY_TYPE.gallons_child.fuelCodes).toEqual(['ULSD', 'DSL', 'ULSR']);
  });

  it('marks exactly the two one-time types', () => {
    expect(isOneTimeBonusType('gallons_parent')).toBe(true);
    expect(isOneTimeBonusType('gallons_child')).toBe(true);
    expect(isOneTimeBonusType('gallons_legacy')).toBe(false);
    expect(isOneTimeBonusType('swipes_legacy')).toBe(false);
    expect(REFERRAL_BONUS_SPECS.filter((s) => !s.recurring).map((s) => s.type)).toEqual([
      'gallons_parent',
      'gallons_child',
    ]);
  });
});

describe('Zoho Calculation picklist → bonus types', () => {
  it('each legacy value selects exactly ONE type — the picklist is single-select', () => {
    // Previously asserted BOTH types for either value, which made 'Gallons (Legacy)' and
    // 'Swipes (Legacy)' indistinguishable in effect and paid per-gallon on top of per-swipe for the
    // 615 referrers set to Swipes (Legacy). The import deliberately split the roster 615/50.
    expect(bonusTypesForCalculation('Gallons (Legacy)')).toEqual(['gallons_legacy']);
    expect(bonusTypesForCalculation('Swipes (Legacy)')).toEqual(['swipes_legacy']);
  });

  it('the new-logic values select a single type each', () => {
    expect(bonusTypesForCalculation('Gallons (Parent)')).toEqual(['gallons_parent']);
    expect(bonusTypesForCalculation('Gallons (Child)')).toEqual(['gallons_child']);
  });

  it('unset / -None- / unknown selects nothing (null on every CHILD; the parent copy is populated)', () => {
    expect(bonusTypesForCalculation(null)).toEqual([]);
    expect(bonusTypesForCalculation(undefined)).toEqual([]);
    expect(bonusTypesForCalculation('')).toEqual([]);
    expect(bonusTypesForCalculation('  ')).toEqual([]);
    expect(bonusTypesForCalculation('-None-')).toEqual([]);
    expect(bonusTypesForCalculation('Gallons (New Logic 3)')).toEqual([]);
  });

  it('every picklist value in the spec round-trips', () => {
    for (const spec of REFERRAL_BONUS_SPECS) {
      expect(bonusTypesForCalculation(spec.zohoPicklistValue)).toContain(spec.type);
    }
  });
});
