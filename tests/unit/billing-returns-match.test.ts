/**
 * Returns matching must not reverse the same money twice. `POST /billing/returns/:id/match`
 * deletes the payment in CMP, so a return that is already matched — or a payment another return
 * already reversed — has to be refused before the CMP call, not merely hidden in the UI.
 */
import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { amountsMatch, assertReturnMatchable } from '../../src/modules/billing/returnsMatch.js';

const ret = (over: Partial<Parameters<typeof assertReturnMatchable>[0]> = {}) => ({
  id: 7,
  matched: false,
  matchedBy: null,
  source: 'mx-ach',
  ...over,
});
const tx = (over: Partial<Parameters<typeof assertReturnMatchable>[1]> = {}) => ({
  id: 99,
  isReturned: false,
  source: 'mx',
  ...over,
});

function conflict(fn: () => void): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected a ConflictError');
}

describe('assertReturnMatchable', () => {
  it('allows an unmatched return against a payment that was never returned', () => {
    expect(() => assertReturnMatchable(ret(), tx())).not.toThrow();
  });

  it('refuses a return that is already matched, and names who matched it', () => {
    const err = conflict(() => assertReturnMatchable(ret({ matched: true, matchedBy: 'Zoho (workflow)' }), tx()));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('already matched');
    expect(err.message).toContain('Zoho (workflow)');
  });

  it('refuses an already-matched return even with no actor recorded', () => {
    const err = conflict(() => assertReturnMatchable(ret({ matched: true }), tx()));
    expect(err.statusCode).toBe(409);
    expect(err.message).not.toContain('(by');
  });

  it('refuses a payment another return already reversed', () => {
    const err = conflict(() => assertReturnMatchable(ret(), tx({ isReturned: true })));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('already flagged returned');
  });

  it('refuses a Stripe dispute matched against an MX transaction', () => {
    const err = conflict(() => assertReturnMatchable(ret({ source: 'stripe-dispute' }), tx({ source: 'mx' })));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('wrong payment rail');
  });

  it('refuses an MX return matched against a Stripe transaction', () => {
    const err = conflict(() => assertReturnMatchable(ret({ source: 'mx-dispute' }), tx({ source: 'stripe' })));
    expect(err.statusCode).toBe(409);
  });

  it('allows a Stripe dispute matched against a Stripe transaction', () => {
    expect(() => assertReturnMatchable(ret({ source: 'stripe-dispute' }), tx({ source: 'stripe' }))).not.toThrow();
  });

  it('allows an unknown/legacy return source against any transaction (fail open)', () => {
    expect(() => assertReturnMatchable(ret({ source: 'legacy' }), tx({ source: 'zelle' }))).not.toThrow();
  });
});

describe('amountsMatch', () => {
  it('matches equal amounts to the cent', () => {
    expect(amountsMatch('2000.00', 2000)).toBe(true);
    expect(amountsMatch(1234.5, '1234.50')).toBe(true);
  });

  it('rejects a partial amount (dispute smaller than the original charge)', () => {
    expect(amountsMatch(500, 2000)).toBe(false);
  });

  it('rejects when either side is missing rather than guessing', () => {
    expect(amountsMatch(null, 2000)).toBe(false);
    expect(amountsMatch(2000, undefined)).toBe(false);
    expect(amountsMatch(null, null)).toBe(false);
  });

  it('rejects a non-numeric amount', () => {
    expect(amountsMatch('not-a-number', 2000)).toBe(false);
  });
});
