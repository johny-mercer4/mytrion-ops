/**
 * PHASE 7 HAD NO GATE. `passReady` did not mention the phase, so "Pass phase" was enabled on a case
 * with a negative average weekly net cash flow — the one thing this phase exists to prevent. And the
 * decision bar's Deposit / prepaid button was shown only on Phase 6, so on the phase whose prescribed
 * outcome IS deposit / prepaid the reviewer could not record it.
 */
import { describe, expect, it } from 'vitest';
import { HARD_STOP_COPY, hardStopTone, hardStopsCanPass } from './caseHardStops';

describe('hardStopsCanPass', () => {
  it('refuses to pass until the reviewer has recorded an outcome', () => {
    expect(hardStopsCanPass(null, true)).toBe(false);
  });

  it('passes only on Continue with both stops clear', () => {
    expect(hardStopsCanPass('continue', true)).toBe(true);
  });

  /** THE ONE THAT MATTERS: Continue must not pass a case a stop actually fired on. */
  it('refuses Continue when a stop fired', () => {
    expect(hardStopsCanPass('continue', false)).toBe(false);
  });

  it('never passes on restricted or unresolved, even with everything clear', () => {
    // These are real answers, and neither of them is "pass" — they take the deposit / manager door.
    expect(hardStopsCanPass('restricted', true)).toBe(false);
    expect(hardStopsCanPass('unresolved', true)).toBe(false);
  });
});

describe('the two stops', () => {
  /**
   * BOTH ROWS ALWAYS RENDER, fired or not. The old pane listed only what triggered, which left a
   * reviewer unable to tell "checked and clear" from "never checked".
   */
  it('carries clear copy for each stop, not only failure copy', () => {
    expect(HARD_STOP_COPY).toHaveLength(2);
    for (const stop of HARD_STOP_COPY) {
      expect(stop.clearLabel.length).toBeGreaterThan(0);
      expect(stop.clearDetail.length).toBeGreaterThan(0);
    }
  });

  /** Cash flow maps TWO server codes: a real negative, and a figure nobody recorded. */
  it('maps both cash-flow codes onto the one row', () => {
    const cashFlow = HARD_STOP_COPY.find((s) => s.id === 'cash_flow');
    expect(cashFlow?.codes).toEqual(['negative_cash_flow', 'cash_flow_unrecorded']);
    expect(HARD_STOP_COPY.find((s) => s.id === 'bureau')?.codes).toEqual([
      'no_credit_bureau_record',
    ]);
  });

  /** Only the three tones `.va-id-check[data-mark]` actually styles — an unlisted value is no edge. */
  it('uses only styled mark tones', () => {
    expect(['ok', 'missing', 'inconsistent']).toContain(hardStopTone(true));
    expect(['ok', 'missing', 'inconsistent']).toContain(hardStopTone(false));
    expect(hardStopTone(false)).toBe('ok');
    expect(hardStopTone(true)).toBe('inconsistent');
  });
});
