/**
 * The Billing Ledger's arithmetic invariants.
 *
 * Every assertion here exists because breaking it produces PLAUSIBLE WRONG MONEY — a number an agent
 * would act on. Specifically:
 *   • `closing = opening + debit − credit` is the whole model (TZ §5); a rounding or sign slip is
 *     invisible on screen.
 *   • `opening = null ⇒ closing = null`. Coercing a missing opening to 0 yields a confidently wrong
 *     closing that lands in the variance queue instead of the migration backlog.
 *   • The chain (`S1.credit === S2.debit`, `S2.credit === S3.debit`) is what makes the sub-ledgers a
 *     ledger rather than three unrelated reports. It holds because the sections SHARE feed functions,
 *     so these tests are really asserting that nobody re-implemented one side.
 *   • The roll-forward: an opening balance anchors INCEPTION, so any later window must accumulate from
 *     the anchor. Skipping it silently understates or overstates every period after the first.
 *   • `endDate` is INCLUSIVE at the API boundary and EXCLUSIVE below it, converted exactly once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above module scope, so every mock fn must come from vi.hoisted —
// the pattern the repo's route tests use.
const { dwhQuery, findLiveBatch } = vi.hoisted(() => ({
  dwhQuery: vi.fn(async (_sql: string, _params?: readonly unknown[]) => [] as unknown[]),
  findLiveBatch: vi.fn(async () => new Map<string, { asOfDate: string; amount: string }>()),
}));

vi.mock('../../src/integrations/dwh.js', () => ({ dwh: { query: dwhQuery } }));
vi.mock('../../src/repos/maintenanceCaseRepo.js', () => ({
  maintenanceCaseRepo: {
    sumByCarrierAndMethod: vi.fn(async () => new Map<string, number>()),
    listForLedger: vi.fn(async () => []),
  },
}));
vi.mock('../../src/repos/moneyCodeRequestRepo.js', () => ({
  moneyCodeRequestRepo: { sumByCarrier: vi.fn(async () => new Map<string, number>()) },
}));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({
  paymentTransactionRepo: {
    sumReceivedByCarrier: vi.fn(async () => new Map<string, number>()),
    sumUnappliedByCarrier: vi.fn(async () => new Map<string, number>()),
    unappliedAgeRows: vi.fn(async () => []),
    listPage: vi.fn(async () => ({ rows: [], page: 1, limit: 50, total: 0, hasMore: false })),
  },
}));

vi.mock('../../src/repos/ledgerOpeningBalanceRepo.js', () => ({
  ledgerOpeningBalanceRepo: { findLiveBatch },
  num: (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0),
}));

import { computeSection, sectionTotals, shiftYmd } from '../../src/modules/billing/ledger/compute.js';
import type { LedgerCarrier } from '../../src/modules/billing/ledger/clientType.js';

const LOC: LedgerCarrier = {
  carrierId: '5000001',
  companyName: 'LOC CO',
  clientType: 'LOC',
  billingCycle: 'WEEKLY_MON_SUN',
  source: 'dwh',
  dwhValue: 'LOC',
  isActive: true,
};
const PREPAY: LedgerCarrier = { ...LOC, carrierId: '5000002', companyName: 'PREPAY CO', clientType: 'Prepay' };

/**
 * Route each DWH query to a canned aggregate by sniffing its FROM clause. Crude on purpose: the point
 * is to control what each FEED returns, not to test SQL text (ledger-feeds-sql covers that).
 */
function stubDwh(values: {
  loads?: number;
  draws?: number;
  fuel?: number;
  invoiced?: number;
  invoicePayments?: number;
}): void {
  dwhQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('cmp_billing_history')) {
      return [{ carrier_id: '5000001', loads: String(values.loads ?? 0), draws: String(values.draws ?? 0) },
              { carrier_id: '5000002', loads: String(values.loads ?? 0), draws: String(values.draws ?? 0) }];
    }
    if (sql.includes('cmp_transaction')) {
      return [{ carrier_id: '5000001', amt: String(values.fuel ?? 0) },
              { carrier_id: '5000002', amt: String(values.fuel ?? 0) }];
    }
    if (sql.includes('cmp_invoice_payment')) {
      return [{ carrier_id: '5000001', amt: String(values.invoicePayments ?? 0) }];
    }
    if (sql.includes('cmp_invoice')) {
      return [{ carrier_id: '5000001', amt: String(values.invoiced ?? 0) }];
    }
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findLiveBatch.mockResolvedValue(new Map());
  stubDwh({});
});

describe('shiftYmd', () => {
  it('crosses month and year boundaries without a local-midnight Date', () => {
    expect(shiftYmd('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftYmd('2026-03-01', -1)).toBe('2026-02-28');
    // A leap year — 2028 is one, so Feb has 29 days.
    expect(shiftYmd('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('closing = opening + debit − credit', () => {
  it('holds for a recorded opening', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-loc', { asOfDate: '2026-07-01', amount: '1000.00' }]]) as never,
    );
    stubDwh({ loads: 500, draws: 100, fuel: 250 });

    const [row] = await computeSection({
      section: 'cb-loc',
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      carriers: [LOC],
    });

    expect(row).toBeDefined();
    // Debit nets the draws in, matching ops' `loaded = TopUp − RMVE`.
    expect(row!.debit).toBe(400);
    expect(row!.credit).toBe(250);
    expect(row!.opening).toBe(1000);
    expect(row!.closing).toBe(1000 + 400 - 250);
    expect(row!.openingSource).toBe('recorded');
  });

  it('rounds to cents rather than accumulating float drift', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-loc', { asOfDate: '2026-07-01', amount: '0.10' }]]) as never,
    );
    stubDwh({ loads: 0.2, fuel: 0.3 });
    const [row] = await computeSection({
      section: 'cb-loc',
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      carriers: [LOC],
    });
    // 0.1 + 0.2 - 0.3 is 5.55e-17 in raw float.
    expect(row!.closing).toBe(0);
  });
});

describe('a missing opening balance is null, never zero', () => {
  it('returns null opening AND null closing, but still reports the movement', async () => {
    stubDwh({ loads: 900, fuel: 400 });
    const [row] = await computeSection({
      section: 'cb-loc',
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      carriers: [LOC],
    });

    expect(row!.opening).toBeNull();
    expect(row!.closing).toBeNull();
    expect(row!.openingSource).toBe('missing');
    // Debit/Credit are independently true and must still be shown.
    expect(row!.debit).toBe(900);
    expect(row!.credit).toBe(400);
    expect(row!.warnings.join(' ')).toMatch(/no opening balance/i);
  });

  it('excludes those rows from the opening/closing totals and counts them separately', async () => {
    const rows = [
      { opening: 100, debit: 10, credit: 5, closing: 105 },
      { opening: null, debit: 20, credit: 8, closing: null },
    ].map((r) => ({ ...r, carrierId: 'x', companyName: '', clientType: 'LOC' as const, billingCycle: '', section: 'cb-loc' as const, openingAsOf: null, openingSource: 'missing' as const, components: {}, warnings: [] }));

    const t = sectionTotals(rows);
    // Debit and Credit include everything; opening/closing only the rows that could state one.
    expect(t.debit).toBe(30);
    expect(t.credit).toBe(13);
    expect(t.opening).toBe(100);
    expect(t.closing).toBe(105);
    expect(t.missingOpening).toBe(1);
  });
});

describe('a window that opens before the carrier’s ledger does', () => {
  it('states no balance and names the anchor date rather than guessing', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-loc', { asOfDate: '2026-07-15', amount: '500.00' }]]) as never,
    );
    const [row] = await computeSection({
      section: 'cb-loc',
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      carriers: [LOC],
    });
    expect(row!.opening).toBeNull();
    expect(row!.closing).toBeNull();
    expect(row!.openingSource).toBe('predates-inception');
    expect(row!.warnings.join(' ')).toContain('2026-07-15');
  });
});

describe('roll-forward from the anchor', () => {
  it('accumulates movement between the anchor and the window start', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-loc', { asOfDate: '2026-07-01', amount: '1000.00' }]]) as never,
    );
    // Every feed call returns the same figures, so the roll-forward window contributes the same
    // net movement as the requested window: +400 − 250 = +150.
    stubDwh({ loads: 500, draws: 100, fuel: 250 });

    const [row] = await computeSection({
      section: 'cb-loc',
      startDate: '2026-07-10',
      endDate: '2026-07-16',
      carriers: [LOC],
    });

    expect(row!.openingSource).toBe('rolled-forward');
    // 1000 anchor + 150 rolled forward.
    expect(row!.opening).toBe(1150);
    expect(row!.closing).toBe(1150 + 400 - 250);
  });

  it('does not roll forward when the window starts exactly on the anchor', async () => {
    findLiveBatch.mockResolvedValue(
      new Map([['5000001:cb-loc', { asOfDate: '2026-07-10', amount: '1000.00' }]]) as never,
    );
    stubDwh({ loads: 500, draws: 100, fuel: 250 });
    const [row] = await computeSection({
      section: 'cb-loc',
      startDate: '2026-07-10',
      endDate: '2026-07-16',
      carriers: [LOC],
    });
    expect(row!.openingSource).toBe('recorded');
    expect(row!.opening).toBe(1000);
  });
});

describe('the section chain is shared code, not convention', () => {
  it('cb-loc.credit === unbilled.debit for the same carrier and period', async () => {
    stubDwh({ loads: 900, fuel: 321.45, invoiced: 200 });
    const [cb] = await computeSection({
      section: 'cb-loc', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [LOC],
    });
    const [unbilled] = await computeSection({
      section: 'unbilled', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [LOC],
    });
    expect(cb!.credit).toBe(unbilled!.debit);
  });

  it('unbilled.credit === ar.debit for the same carrier and period', async () => {
    stubDwh({ fuel: 100, invoiced: 777.77, invoicePayments: 50 });
    const [unbilled] = await computeSection({
      section: 'unbilled', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [LOC],
    });
    const [ar] = await computeSection({
      section: 'ar', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [LOC],
    });
    expect(unbilled!.credit).toBe(ar!.debit);
  });

  it('untopped.credit === cb-prepay.debit gross of draws', async () => {
    stubDwh({ loads: 640.5, draws: 40.5, fuel: 10 });
    const [cbPrepay] = await computeSection({
      section: 'cb-prepay', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [PREPAY],
    });
    const [untopped] = await computeSection({
      section: 'untopped', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [PREPAY],
    });
    // Un Top-Upped's Credit is the top-up APPLIED (the load), while Customer Balance's Debit nets the
    // draws — so the link is to the gross load, which is Debit + draws.
    expect(untopped!.credit).toBe(640.5);
    expect(cbPrepay!.debit).toBe(600);
  });
});

describe('section ownership by client type', () => {
  it('drops carriers whose type does not own the section', async () => {
    const rows = await computeSection({
      section: 'ar', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [PREPAY],
    });
    // AR is LOC-only; a Prepay carrier must not appear at all rather than appear with zeros.
    expect(rows).toEqual([]);
  });

  it('keeps only the matching type from a mixed list', async () => {
    const rows = await computeSection({
      section: 'cb-prepay', startDate: '2026-07-01', endDate: '2026-07-07', carriers: [LOC, PREPAY],
    });
    expect(rows.map((r) => r.carrierId)).toEqual(['5000002']);
  });
});

describe('endDate is inclusive at the boundary and exclusive below it', () => {
  it('converts exactly once — a single-day window queries that one day', async () => {
    const seen: string[][] = [];
    dwhQuery.mockImplementation(async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('cmp_billing_history')) seen.push((params ?? []).slice(0, 2).map(String));
      return [];
    });
    await computeSection({
      section: 'cb-loc', startDate: '2026-08-01', endDate: '2026-08-01', carriers: [LOC],
    });
    // Inclusive 08-01..08-01 becomes the exclusive half-open range [08-01, 08-02).
    expect(seen[0]).toEqual(['2026-08-01', '2026-08-02']);
  });
});
