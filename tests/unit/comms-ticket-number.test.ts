/**
 * Ticket number formatting — the pure half of `modules/comms/ticketNumber.ts`.
 *
 * Worth its own suite because the value arrives from `nextval(...)::text` under postgres.js, i.e. as a
 * STRING for a bigint column. Every assertion here is about that boundary: the prefix must be chosen by
 * kind, the pad must not depend on driver number coercion, and a value past the pad width must widen
 * rather than truncate — a truncated number would collide with an earlier ticket, which is the one thing
 * a human-readable identifier may never do.
 */
import { describe, expect, it } from 'vitest';
import { formatTicketNumber } from '../../src/modules/comms/ticketNumber.js';
import type { CommsTicketKind } from '../../src/db/schema/index.js';

/** Every kind in the union. Listed explicitly so a new kind fails this suite instead of shipping. */
const ALL_KINDS: CommsTicketKind[] = ['ticket', 'request', 'escalation'];

describe('formatTicketNumber — prefix per kind', () => {
  it('T / R / E, one per kind', () => {
    expect(formatTicketNumber('ticket', 123)).toBe('T-000123');
    expect(formatTicketNumber('request', 45)).toBe('R-000045');
    expect(formatTicketNumber('escalation', 12)).toBe('E-000012');
  });

  it('the three kinds share the sequence, so the PREFIX is what disambiguates', () => {
    // Same sequence value, three kinds: the numbers must differ, or T-000007 and E-000007 would be the
    // same identifier to a human reading a queue.
    const numbers = ALL_KINDS.map((k) => formatTicketNumber(k, 7));
    expect(new Set(numbers).size).toBe(ALL_KINDS.length);
  });

  it('no kind produces an "undefined-" prefix', () => {
    for (const kind of ALL_KINDS) {
      expect(formatTicketNumber(kind, 1)).toMatch(/^[TRE]-\d{6,}$/);
    }
  });
});

describe('formatTicketNumber — zero padding', () => {
  it('pads to six digits', () => {
    expect(formatTicketNumber('ticket', 1)).toBe('T-000001');
    expect(formatTicketNumber('ticket', 999)).toBe('T-000999');
    expect(formatTicketNumber('ticket', 999_999)).toBe('T-999999');
  });

  it('a string and the equivalent number pad identically — no driver-coercion dependency', () => {
    // The real input is `nextval(...)::text`; a test that only passed numbers would not exercise it.
    for (const value of [1, 42, 999, 100_000]) {
      expect(formatTicketNumber('ticket', String(value))).toBe(formatTicketNumber('ticket', value));
    }
  });

  it('already-padded input is not padded twice', () => {
    expect(formatTicketNumber('ticket', '000123')).toBe('T-000123');
  });
});

describe('formatTicketNumber — values past the pad width are NOT truncated', () => {
  it('a seven-digit value keeps all seven digits', () => {
    expect(formatTicketNumber('ticket', 1_000_000)).toBe('T-1000000');
    expect(formatTicketNumber('ticket', 1_234_567)).toBe('T-1234567');
  });

  it('a bigint-sized string survives intact', () => {
    // bigint arrives as a string precisely because it can exceed Number.MAX_SAFE_INTEGER; routing it
    // through a number would corrupt it silently.
    const huge = '9007199254740993'; // MAX_SAFE_INTEGER + 2
    expect(formatTicketNumber('escalation', huge)).toBe(`E-${huge}`);
  });

  it('is injective for distinct sequence values around the pad boundary', () => {
    const values = [999_998, 999_999, 1_000_000, 1_000_001];
    const formatted = values.map((v) => formatTicketNumber('request', v));
    expect(new Set(formatted).size).toBe(values.length);
  });
});

describe('formatTicketNumber — non-digits are stripped', () => {
  it('drops separators, whitespace and stray text', () => {
    expect(formatTicketNumber('ticket', ' 1_234 ')).toBe('T-001234');
    expect(formatTicketNumber('ticket', '1,234')).toBe('T-001234');
    expect(formatTicketNumber('ticket', 'nextval 42')).toBe('T-000042');
  });

  it('drops a sign rather than emitting "T--5"', () => {
    // A sequence never goes negative; this asserts the formatter cannot emit a malformed number if one
    // somehow arrived.
    expect(formatTicketNumber('ticket', -5)).toBe('T-000005');
  });

  it('an all-digits-free value degrades to the zero number, never NaN or a bare prefix', () => {
    expect(formatTicketNumber('ticket', 'abc')).toBe('T-000000');
    expect(formatTicketNumber('ticket', '')).toBe('T-000000');
    expect(formatTicketNumber('ticket', Number.NaN)).toBe('T-000000');
  });

  it('never emits a value containing a non-digit after the prefix', () => {
    const inputs: (string | number)[] = ['1e3', '0x1f', '12.34', '  7  ', 1e3];
    for (const input of inputs) {
      expect(formatTicketNumber('ticket', input)).toMatch(/^T-\d+$/);
    }
  });
});
