/**
 * Aging buckets and the drift guard on the extracted AR rules.
 *
 * The drift guard is the important half. `DUE` / `OPEN_INVOICE` / `PAYMENT_OK` were INLINED in
 * analytics/dimensions/receivables.ts before the ledger existed; both now import them from arRules.ts.
 * If someone edits one of those strings, two reports change at once — a shipped analytics report and the
 * ledger's AR sub-ledger — so the exact text is pinned here. Same spirit as the index-predicate
 * assertion in cs-maintenance-repo.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  DUE,
  LEDGER_AGING_BUCKETS,
  OPEN_INVOICE,
  PAYMENT_OK,
  RECEIVABLES_AGING_BUCKETS,
  agingBucketSql,
} from '../../src/modules/billing/ledger/arRules.js';

describe('the extracted rules are character-identical to what receivables.ts inlined', () => {
  it('DUE floors at zero so an overpayment cannot net off another invoice', () => {
    expect(DUE).toBe('greatest(i.total_amount - coalesce(i.total_paid, 0), 0)');
  });

  it('OPEN_INVOICE keeps the $1 floor and both open statuses', () => {
    expect(OPEN_INVOICE).toBe(
      "i.status in ('PENDING', 'PARTIALLY_PAID') and greatest(i.total_amount - coalesce(i.total_paid, 0), 0) >= 1",
    );
  });

  it('PAYMENT_OK excludes reversed/bounced payments', () => {
    expect(PAYMENT_OK).toBe('coalesce(p.is_failed, false) = false');
  });
});

describe('the receivables bucket set is untouched by the extraction', () => {
  it('still has exactly its five shipped buckets, in order', () => {
    expect(RECEIVABLES_AGING_BUCKETS.map((b) => b.key)).toEqual([
      'Current',
      '1-7 days',
      '8-30 days',
      '31-60 days',
      '60+ days',
    ]);
  });

  it('still folds a null due_date into Current — changing that is a separate decision', () => {
    const current = RECEIVABLES_AGING_BUCKETS.find((b) => b.key === 'Current');
    expect(current?.when).toBe('i.due_date is null or i.due_date::date >= current_date');
  });
});

describe('the ledger bucket set', () => {
  it('is the TZ four PLUS current and no_due_date, in evaluation order', () => {
    expect(LEDGER_AGING_BUCKETS.map((b) => b.key)).toEqual([
      // no_due_date FIRST: the CASE takes the first match, and a null due_date would otherwise be
      // swallowed by a `between` comparison that is null-propagating.
      'no_due_date',
      'current',
      'd0_7',
      'd8_14',
      'd15_30',
      'd30_plus',
    ]);
  });

  it('separates not-yet-due from 0–7 days overdue', () => {
    // Verified against production 2026-08-06: 777 invoices worth $3.8M are not yet due. Folding them
    // into d0_7 as the TZ's four-bucket set implies would report $3.8M as a week overdue.
    const current = LEDGER_AGING_BUCKETS.find((b) => b.key === 'current');
    const d0_7 = LEDGER_AGING_BUCKETS.find((b) => b.key === 'd0_7');
    expect(current?.when).toContain('<= 0');
    expect(d0_7?.when).toContain('between 1 and 7');
  });

  it('covers the boundaries with no gap and no overlap', () => {
    // Day ranges as [lo, hi] parsed out of the `between` clauses, plus the open-ended tail.
    const ranges = [
      { key: 'd0_7', lo: 1, hi: 7 },
      { key: 'd8_14', lo: 8, hi: 14 },
      { key: 'd15_30', lo: 15, hi: 30 },
    ];
    for (const r of ranges) {
      const def = LEDGER_AGING_BUCKETS.find((b) => b.key === r.key);
      expect(def?.when).toContain(`between ${r.lo} and ${r.hi}`);
    }
    // 31 and up belongs to d30_plus — `> 30`, so day 31 is covered and day 30 is not double-counted.
    expect(LEDGER_AGING_BUCKETS.find((b) => b.key === 'd30_plus')?.when).toContain('> 30');
  });

  it('guards every day-range bucket against a null due_date', () => {
    // Without the guard, `null between 1 and 7` is NULL, the arm does not match, and the invoice silently
    // falls through to the CASE's else — landing in whichever bucket happens to be last.
    for (const b of LEDGER_AGING_BUCKETS) {
      if (b.key === 'no_due_date') continue;
      expect(b.when).toContain('i.due_date is not null');
    }
  });

  it('gives the worst two buckets the danger tone and not-yet-due a good one', () => {
    const tone = (k: string): string | undefined => LEDGER_AGING_BUCKETS.find((b) => b.key === k)?.tone;
    expect(tone('current')).toBe('good');
    expect(tone('d8_14')).toBe('warn');
    expect(tone('d15_30')).toBe('danger');
    expect(tone('d30_plus')).toBe('danger');
    // no_due_date is a data-quality flag, not a severity.
    expect(tone('no_due_date')).toBe('muted');
  });
});

describe('agingBucketSql', () => {
  it('emits arms in declaration order, so the first match wins', () => {
    const sql = agingBucketSql(LEDGER_AGING_BUCKETS);
    const order = LEDGER_AGING_BUCKETS.map((b) => sql.indexOf(`'${b.key}'`));
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });

  it('is a self-contained CASE expression with every bucket present', () => {
    const sql = agingBucketSql(LEDGER_AGING_BUCKETS);
    expect(sql.startsWith('case')).toBe(true);
    expect(sql.trimEnd().endsWith('end')).toBe(true);
    for (const b of LEDGER_AGING_BUCKETS) expect(sql).toContain(`'${b.key}'`);
  });

  it('renders the receivables set too — one helper, two configs', () => {
    const sql = agingBucketSql(RECEIVABLES_AGING_BUCKETS);
    expect(sql).toContain("'Current'");
    expect(sql).toContain("'60+ days'");
    // And does NOT leak the ledger's keys into it.
    expect(sql).not.toContain("'d30_plus'");
  });
});
