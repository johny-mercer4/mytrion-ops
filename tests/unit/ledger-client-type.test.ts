/**
 * Ledger scope resolution — which carriers the module covers, and whether each is LOC or Prepay.
 *
 * Two of these guard bugs that already happened once:
 *   • `dim_company.is_active` is an INTEGER (0/1) while its `is_*` siblings are real booleans. A strict
 *     `=== true` silently excluded EVERY typed carrier — the scope read 0 instead of 2,847 — and nothing
 *     in typecheck or lint catches it, because both types are assignable to the row shape.
 *   • An untyped carrier must fall OUT of scope, not default to LOC. Defaulting would invent an
 *     8,000-carrier AR book out of mostly-inactive records.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dwhQuery, findOpen, findOpenBatch, findOpenAll } = vi.hoisted(() => ({
  dwhQuery: vi.fn(async (_sql: string, _params?: readonly unknown[]) => [] as unknown[]),
  findOpen: vi.fn(async () => undefined as unknown),
  findOpenBatch: vi.fn(async () => new Map<string, { clientType: string }>()),
  findOpenAll: vi.fn(async () => new Map<string, { clientType: string }>()),
}));

vi.mock('../../src/integrations/dwh.js', () => ({ dwh: { query: dwhQuery } }));
vi.mock('../../src/repos/ledgerClientTypeRepo.js', () => ({
  ledgerClientTypeRepo: { findOpen, findOpenBatch, findOpenAll },
}));

import {
  clearLedgerScopeCache,
  listLedgerCarriers,
  lookupLedgerCarrier,
  normalizeClientType,
} from '../../src/modules/billing/ledger/clientType.js';

interface Row {
  carrier_id: string;
  company_name: string | null;
  payment_terms: string | null;
  billing_cycle: string | null;
  is_wex_funded: boolean | null;
  is_active: boolean | number | null;
}

const row = (o: Partial<Row> & { carrier_id: string }): Row => ({
  company_name: 'CO',
  payment_terms: 'LOC',
  billing_cycle: 'WEEKLY_MON_SUN',
  is_wex_funded: false,
  is_active: 1,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  findOpen.mockResolvedValue(undefined);
  findOpenBatch.mockResolvedValue(new Map());
  findOpenAll.mockResolvedValue(new Map());
  // The scope query is cached for 60s, so it MUST be cleared between tests or each case would assert
  // against the first one's fixture.
  clearLedgerScopeCache();
});

describe('normalizeClientType', () => {
  it('maps every spelling the four upstream systems use', () => {
    expect(normalizeClientType('LOC')).toBe('LOC');
    expect(normalizeClientType('loc')).toBe('LOC');
    expect(normalizeClientType('Line of Credit')).toBe('LOC');
    expect(normalizeClientType('Prepay')).toBe('Prepay');
    expect(normalizeClientType('PREPAY')).toBe('Prepay');
  });

  it('folds Deposit into Prepay — a prepaid arrangement, matching agentDwh', () => {
    expect(normalizeClientType('Deposit')).toBe('Prepay');
  });

  it('returns null for absent or unrecognized values rather than guessing a default', () => {
    expect(normalizeClientType('')).toBeNull();
    expect(normalizeClientType(null)).toBeNull();
    expect(normalizeClientType(undefined)).toBeNull();
    expect(normalizeClientType('Secured Line of Credit')).toBeNull();
    expect(normalizeClientType('WEX Funded')).toBeNull();
  });
});

describe('is_active is an INTEGER, not a boolean', () => {
  it('treats 1 as active — a strict === true once excluded the whole book', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001', is_active: 1 })]);
    const { carriers, excluded } = await listLedgerCarriers();
    expect(carriers).toHaveLength(1);
    expect(carriers[0]!.isActive).toBe(true);
    expect(excluded.inactive).toBe(0);
  });

  it('treats 0 as inactive and counts it', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001', is_active: 0 })]);
    const { carriers, excluded } = await listLedgerCarriers();
    expect(carriers).toHaveLength(0);
    expect(excluded.inactive).toBe(1);
  });

  it('still accepts a real boolean, in case the column type is ever fixed upstream', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001', is_active: true })]);
    const { carriers } = await listLedgerCarriers();
    expect(carriers).toHaveLength(1);
  });

  it('includes inactive carriers when asked — a stale balance should stay visible', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001', is_active: 0 })]);
    const { carriers } = await listLedgerCarriers({ includeInactive: true });
    expect(carriers).toHaveLength(1);
  });
});

describe('exclusions are counted, not silent', () => {
  it('drops WEX-Funded carriers (TZ §5.3) and counts them', async () => {
    dwhQuery.mockResolvedValue([
      row({ carrier_id: '5000001' }),
      row({ carrier_id: '5000002', is_wex_funded: true }),
    ]);
    const { carriers, excluded } = await listLedgerCarriers();
    expect(carriers.map((c) => c.carrierId)).toEqual(['5000001']);
    expect(excluded.wexFunded).toBe(1);
  });

  it('drops untyped carriers rather than defaulting them to LOC', async () => {
    dwhQuery.mockResolvedValue([
      row({ carrier_id: '5000001' }),
      row({ carrier_id: '5000002', payment_terms: null }),
      row({ carrier_id: '5000003', payment_terms: '' }),
    ]);
    const { carriers, excluded } = await listLedgerCarriers();
    expect(carriers.map((c) => c.carrierId)).toEqual(['5000001']);
    expect(excluded.noType).toBe(2);
  });

  it('a WEX-Funded carrier is excluded even when it also has a type', async () => {
    dwhQuery.mockResolvedValue([
      row({ carrier_id: '5000001', payment_terms: 'Prepay', is_wex_funded: true }),
    ]);
    const { carriers, excluded } = await listLedgerCarriers();
    expect(carriers).toHaveLength(0);
    expect(excluded.wexFunded).toBe(1);
    // Not double-counted as untyped.
    expect(excluded.noType).toBe(0);
  });
});

describe('an override beats the DWH', () => {
  it('flips the resolved type and reports the source', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001', payment_terms: 'LOC' })]);
    findOpenAll.mockResolvedValue(new Map([['5000001', { clientType: 'Prepay' }]]));
    const { carriers } = await listLedgerCarriers();
    expect(carriers[0]!.clientType).toBe('Prepay');
    expect(carriers[0]!.source).toBe('override');
    // The raw DWH value is retained so drift is visible.
    expect(carriers[0]!.dwhValue).toBe('LOC');
  });

  it('brings an UNTYPED carrier into scope — the escape hatch for the ~62% with no payment_terms', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001', payment_terms: null })]);
    findOpenAll.mockResolvedValue(new Map([['5000001', { clientType: 'LOC' }]]));
    const { carriers, excluded } = await listLedgerCarriers();
    expect(carriers).toHaveLength(1);
    expect(carriers[0]!.clientType).toBe('LOC');
    expect(excluded.noType).toBe(0);
  });
});

describe('lookupLedgerCarrier distinguishes WHY a carrier is unavailable', () => {
  it('not-found', async () => {
    dwhQuery.mockResolvedValue([]);
    const r = await lookupLedgerCarrier('9999999');
    expect(r.found).toBe(false);
    expect(r.reason).toBe('not-found');
  });

  it('wex-funded — and still returns the company name so the modal can explain itself', async () => {
    dwhQuery.mockResolvedValue([
      row({ carrier_id: '5000001', company_name: 'WEX CO', is_wex_funded: true }),
    ]);
    const r = await lookupLedgerCarrier('5000001');
    expect(r.found).toBe(false);
    expect(r.reason).toBe('wex-funded');
    expect(r.companyName).toBe('WEX CO');
    expect(r.isWexFunded).toBe(true);
  });

  it('no-type — a different message from not-found, because the fix differs', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001', payment_terms: null })]);
    const r = await lookupLedgerCarrier('5000001');
    expect(r.found).toBe(false);
    expect(r.reason).toBe('no-type');
    expect(r.companyName).toBe('CO');
  });

  it('an empty carrier id short-circuits without touching the DWH', async () => {
    const r = await lookupLedgerCarrier('   ');
    expect(r.found).toBe(false);
    expect(dwhQuery).not.toHaveBeenCalled();
  });
});

describe('the SCD collapse is not optional', () => {
  it('every scope query collapses dim_company to the newest row per carrier', async () => {
    dwhQuery.mockResolvedValue([]);
    await listLedgerCarriers();
    const sql = String(dwhQuery.mock.calls[0]?.[0] ?? '');
    // Without this, a carrier fans out across historical dim rows and every downstream sum multiplies.
    expect(sql).toContain('distinct on (carrier_id)');
    expect(sql).toContain('update_date desc nulls last');
  });
});

describe('the scope cache', () => {
  it('serves a second call without re-scanning the dim', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001' })]);
    await listLedgerCarriers();
    await listLedgerCarriers();
    // 8,145 dim rows per request, several requests per page load — one scan is the point.
    expect(dwhQuery).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight scan between concurrent callers', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001' })]);
    await Promise.all([listLedgerCarriers(), listLedgerCarriers(), listLedgerCarriers()]);
    expect(dwhQuery).toHaveBeenCalledTimes(1);
  });

  it('re-scans after an explicit clear, so an override write is visible at once', async () => {
    dwhQuery.mockResolvedValue([row({ carrier_id: '5000001' })]);
    await listLedgerCarriers();
    clearLedgerScopeCache();
    await listLedgerCarriers();
    expect(dwhQuery).toHaveBeenCalledTimes(2);
  });

  it('does not let a clientType filter poison the cache for another type', async () => {
    dwhQuery.mockResolvedValue([
      row({ carrier_id: '5000001', payment_terms: 'LOC' }),
      row({ carrier_id: '5000002', payment_terms: 'Prepay' }),
    ]);
    const loc = await listLedgerCarriers({ clientType: 'LOC' });
    const prepay = await listLedgerCarriers({ clientType: 'Prepay' });
    // Filtering happens AFTER the cached scan, so both answers are correct off one query.
    expect(loc.carriers.map((c) => c.carrierId)).toEqual(['5000001']);
    expect(prepay.carriers.map((c) => c.carrierId)).toEqual(['5000002']);
    expect(dwhQuery).toHaveBeenCalledTimes(1);
  });
});
