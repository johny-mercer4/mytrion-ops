/**
 * Outstanding days, and the 30-day paid-late count.
 *
 * Both are business arithmetic stated by the requester as
 *   `paid date - (invoice created date + 1) = outstanding days`
 * so the parts worth pinning are the ones a later reader would most plausibly "simplify" away: the
 * grace day, the clamp, and the deliberate silence on unpaid invoices.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { outstandingDays, outstandingLast30 } from './invoiceOutstanding';

const invoice = (createdDate: string | null, paymentDate: string | null = null) => ({
  createdDate,
  paymentDate,
});

afterEach(() => vi.useRealTimers());

describe('outstandingDays', () => {
  it('gives the requester\'s formula: paid - (created + 1)', () => {
    // Raised the 6th, paid the 13th: 13 - 7 = 6 days outstanding.
    expect(outstandingDays(invoice('2026-08-06', '2026-08-13'))).toBe(6);
  });

  it('treats the day after creation as free — that is the +1', () => {
    // Paid the very next day is NOT outstanding. Without the +1 this would read 1.
    expect(outstandingDays(invoice('2026-08-12', '2026-08-13'))).toBe(0);
  });

  it('clamps a same-day payment to 0 rather than -1', () => {
    // CMP can stamp the payment on the day it raises the invoice, which makes the raw figure -1.
    expect(outstandingDays(invoice('2026-08-13', '2026-08-13'))).toBe(0);
  });

  it('is null for an unpaid invoice, not 0', () => {
    // The distinction the requester asked for: an empty slot, never a 0 that reads "paid on time".
    expect(outstandingDays(invoice('2026-08-06', null))).toBeNull();
    expect(outstandingDays(invoice('2026-08-06'))).toBeNull();
  });

  it('is null when the created date is missing or unparseable', () => {
    expect(outstandingDays(invoice(null, '2026-08-13'))).toBeNull();
    expect(outstandingDays(invoice('', '2026-08-13'))).toBeNull();
    expect(outstandingDays(invoice('not a date', '2026-08-13'))).toBeNull();
  });

  it('tolerates a createdDate that carries a time, which CMP passes through raw', () => {
    // `paymentDate` is normalised to YYYY-MM-DD upstream; `createdDate` is not.
    expect(outstandingDays(invoice('2026-08-06T17:42:11.000Z', '2026-08-13'))).toBe(6);
    expect(outstandingDays(invoice('2026-08-06 17:42:11', '2026-08-13'))).toBe(6);
  });

  it('does not drift across a month boundary or a DST change', () => {
    // Whole-day UTC arithmetic: Jul 30 -> Aug 06 is 7 days, minus the grace day.
    expect(outstandingDays(invoice('2026-07-30', '2026-08-06'))).toBe(6);
    // Spans the 01 Nov 2026 US DST end. `Math.round` happens to absorb a 1-hour shift, so this pair
    // would survive a local-midnight parse too — it is here as a boundary regression guard, not as
    // proof that the implementation is UTC. What proves that is the explicit `T00:00:00Z` in ymdUtc.
    expect(outstandingDays(invoice('2026-10-29', '2026-11-05'))).toBe(6);
  });

  it('reads the snake_case field names too', () => {
    expect(outstandingDays({ created_date: '2026-08-06', payment_date: '2026-08-13' })).toBe(6);
  });
});

describe('outstandingLast30', () => {
  // Fixed "now" so the 30-day window is deterministic.
  const freeze = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it('counts how many of the window\'s judgeable invoices were paid late', () => {
    freeze('2026-08-20T12:00:00Z');
    const rows = [
      invoice('2026-08-06', '2026-08-13'), // 6 days  -> late
      invoice('2026-08-12', '2026-08-13'), // 0 days  -> on time
      invoice('2026-08-14', '2026-08-19'), // 4 days  -> late
    ];
    expect(outstandingLast30(rows)).toEqual({ late: 2, total: 3 });
  });

  it('excludes unpaid invoices from BOTH halves', () => {
    freeze('2026-08-20T12:00:00Z');
    const rows = [
      invoice('2026-08-06', '2026-08-13'), // late
      invoice('2026-08-18', null), // unpaid — not judgeable
      invoice('2026-08-19', null), // unpaid — not judgeable
    ];
    // Not `1 of 3`: folding unpaid rows into the denominator would drag the ratio down every time a
    // new invoice is raised, which is backwards for a lateness measure.
    expect(outstandingLast30(rows)).toEqual({ late: 1, total: 1 });
  });

  it('windows on the CREATED date, so paying an old invoice does not change the set', () => {
    freeze('2026-08-20T12:00:00Z');
    const rows = [
      invoice('2026-06-01', '2026-08-19'), // created outside the window, paid inside it
      invoice('2026-08-15', '2026-08-16'), // inside
    ];
    expect(outstandingLast30(rows)).toEqual({ late: 0, total: 1 });
  });

  it('reports 0 of 0 when nothing in the window can be judged', () => {
    freeze('2026-08-20T12:00:00Z');
    expect(outstandingLast30([])).toEqual({ late: 0, total: 0 });
    expect(outstandingLast30([invoice('2026-08-18', null)])).toEqual({ late: 0, total: 0 });
  });
});
