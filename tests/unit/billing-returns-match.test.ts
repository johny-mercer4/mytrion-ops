/**
 * Returns matching must not reverse the same money twice. `POST /billing/returns/:id/match`
 * deletes the payment in CMP, so a return that is already matched — or a payment another return
 * already reversed — has to be refused before the CMP call, not merely hidden in the UI.
 */
import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { assertReturnMatchable } from '../../src/modules/billing/returnsMatch.js';

const ret = (over: Partial<Parameters<typeof assertReturnMatchable>[0]> = {}) => ({
  id: 7,
  matched: false,
  matchedBy: null,
  ...over,
});
const tx = (over: Partial<Parameters<typeof assertReturnMatchable>[1]> = {}) => ({
  id: 99,
  isReturned: false,
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
});
