/**
 * Reconciliation status and tolerance.
 *
 * The status enum is the module's entire output — it decides what lands on an agent's work list — so the
 * assertions here pin the two ways it could quietly lie:
 *   • A FAILED external source must never read as `ok`. "We could not check" and "we checked and it
 *     matched" are opposite facts, and conflating them turns an outage into a clean bill of health.
 *   • `no_opening` must stay distinct from `variance`. During the launch migration almost every carrier
 *     lacks an opening balance; if those counted as variances, the real queue would be unreadable.
 */
import { describe, expect, it } from 'vitest';

import {
  TOLERANCE_ABS,
  TOLERANCE_REL,
  reconSummary,
  reconcileRows,
  withinTolerance,
} from '../../src/modules/billing/ledger/reconcile.js';
import type { SectionMovement } from '../../src/modules/billing/ledger/compute.js';

const movement = (o: Partial<SectionMovement> & { carrierId: string }): SectionMovement => ({
  companyName: 'CO',
  clientType: 'Prepay',
  billingCycle: '',
  section: 'cb-prepay',
  opening: 100,
  openingAsOf: '2026-07-01',
  openingSource: 'recorded',
  debit: 0,
  credit: 0,
  closing: 100,
  components: {},
  warnings: [],
  ...o,
});

const external = (values: Record<string, number>, opts: { stale?: boolean; source?: string } = {}) => ({
  values: new Map(Object.entries(values)),
  source: opts.source ?? 'cmp_balance_after',
  ok: true,
  stale: opts.stale ?? false,
});

describe('withinTolerance', () => {
  it('absorbs sub-dollar noise — the same $1 floor the debtors queue uses', () => {
    expect(withinTolerance(100, 100)).toBe(true);
    expect(withinTolerance(100.99, 100)).toBe(true);
    expect(withinTolerance(100, 100.99)).toBe(true);
    expect(TOLERANCE_ABS).toBe(1.0);
  });

  it('flags a real gap', () => {
    expect(withinTolerance(100, 90)).toBe(false);
  });

  it('scales with the balance so rounding drift on a large figure is not a finding', () => {
    // 0.1% of 1,000,000 is 1,000.
    expect(withinTolerance(1_000_000, 999_500)).toBe(true);
    expect(withinTolerance(1_000_000, 990_000)).toBe(false);
    expect(TOLERANCE_REL).toBe(0.001);
  });

  it('uses the larger of the two tolerances, so a tiny balance still gets the $1 floor', () => {
    // 0.1% of 5 is half a cent, but a 60-cent gap on a $5 balance is not worth a work item.
    expect(withinTolerance(5, 5.6)).toBe(true);
  });
});

describe('status precedence', () => {
  it('a null closing is no_opening, NOT a variance — even when an external value exists', () => {
    const rows = reconcileRows(
      [movement({ carrierId: '1', opening: null, closing: null, openingSource: 'missing', debit: 50 })],
      external({ '1': 999 }),
    );
    expect(rows[0]!.status).toBe('no_opening');
    expect(rows[0]!.variance).toBeNull();
    // The external figure is still carried, so the UI can show what it WOULD have been checked against.
    expect(rows[0]!.externalValue).toBe(999);
  });

  it('a missing external value is source_unavailable, never ok', () => {
    const rows = reconcileRows([movement({ carrierId: '1' })], external({}));
    expect(rows[0]!.status).toBe('source_unavailable');
    expect(rows[0]!.variance).toBeNull();
    expect(rows[0]!.externalValue).toBeNull();
  });

  it('distinguishes an external ZERO from an absent one', () => {
    // Zero is a real balance; absent means we could not ask.
    const rows = reconcileRows([movement({ carrierId: '1', opening: 0, closing: 0 })], external({ '1': 0 }));
    expect(rows[0]!.status).toBe('ok');
    expect(rows[0]!.externalValue).toBe(0);
  });

  it('a value from a different day is stale_external, not ok', () => {
    const rows = reconcileRows([movement({ carrierId: '1' })], external({ '1': 100 }, { stale: true }));
    // Matching against the wrong day must not read as a confirmation.
    expect(rows[0]!.status).toBe('stale_external');
  });

  it('marks a real gap as a variance and records its signed size', () => {
    const rows = reconcileRows([movement({ carrierId: '1', closing: 150 })], external({ '1': 100 }));
    expect(rows[0]!.status).toBe('variance');
    expect(rows[0]!.variance).toBe(50);
  });

  it('keeps the variance signed so direction is visible', () => {
    const rows = reconcileRows([movement({ carrierId: '1', closing: 50 })], external({ '1': 100 }));
    expect(rows[0]!.variance).toBe(-50);
  });

  it('tags every row with the source it was checked against', () => {
    const rows = reconcileRows([movement({ carrierId: '1' })], external({ '1': 100 }, { source: 'efs' }));
    expect(rows[0]!.externalSource).toBe('efs');
  });
});

describe('reconSummary', () => {
  it('counts each status separately and totals only real variances', () => {
    const rows = reconcileRows(
      [
        movement({ carrierId: '1', closing: 100 }),        // ok
        movement({ carrierId: '2', closing: 200 }),        // variance +100
        movement({ carrierId: '3', closing: 50 }),         // variance -50
        movement({ carrierId: '4', opening: null, closing: null }), // no_opening
        movement({ carrierId: '5' }),                      // source_unavailable
      ],
      external({ '1': 100, '2': 100, '3': 100, '4': 0 }),
    );
    const s = reconSummary(rows);
    expect(s.ok).toBe(1);
    expect(s.variance).toBe(2);
    expect(s.no_opening).toBe(1);
    expect(s.source_unavailable).toBe(1);
    // ABSOLUTE total — a +100 and a −50 are $150 of problem, not $50.
    expect(s.varianceTotal).toBe(150);
  });

  it('reports zeros for an empty set rather than throwing', () => {
    const s = reconSummary([]);
    expect(s).toEqual({
      ok: 0,
      variance: 0,
      no_opening: 0,
      source_unavailable: 0,
      stale_external: 0,
      varianceTotal: 0,
    });
  });
});
