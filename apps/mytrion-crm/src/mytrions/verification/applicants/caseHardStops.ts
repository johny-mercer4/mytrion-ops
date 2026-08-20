/**
 * Phase 7 — the pure half: what the two hard stops are called, and what passing the phase requires.
 *
 * The stops themselves are DERIVED server-side (`evaluateHardStops`) from figures recorded in Phase 6,
 * so nothing here computes a verdict. What lives here is the copy for a stop that did NOT fire — the
 * old pane listed only what triggered, which left a reviewer unable to tell "checked and clear" from
 * "not checked" — and the gate that decides whether Phase 7 may be passed at all.
 */
/** What the reviewer records: the SOP's two branches, plus the honest third state. */
export type HardStopAck = 'continue' | 'restricted' | 'unresolved';

export interface HardStopCopy {
  id: string;
  /** Every server code that maps onto this row. Cash flow has two: negative, and not recorded. */
  codes: readonly string[];
  clearLabel: string;
  clearDetail: string;
}

export const HARD_STOP_COPY: readonly HardStopCopy[] = [
  {
    id: 'cash_flow',
    codes: ['negative_cash_flow', 'cash_flow_unrecorded'],
    clearLabel: 'Average weekly net cash flow is above $0',
    clearDetail:
      'Recurring weekly income exceeds recurring weekly expenses, so the cash-flow stop does not fire.',
  },
  {
    id: 'bureau',
    codes: ['no_credit_bureau_record'],
    clearLabel: 'A credit-bureau file exists',
    clearDetail:
      'Phase 6 found a bureau record for this applicant, so the no-file stop does not fire.',
  },
];

/** A fired stop is a finding; a clear one is a pass. Only the three styled tones. */
export function hardStopTone(fired: boolean): string {
  return fired ? 'inconsistent' : 'ok';
}

/**
 * Whether Phase 7 may be passed.
 *
 * TWO CONDITIONS, and the second is the one that was missing entirely: the reviewer has to have
 * recorded an outcome, AND `Continue` is only available when neither stop fired. Before this, Phase 7
 * had no gate at all — `passReady` did not mention it — so "Pass phase" was enabled on a case with a
 * negative cash flow, which is the single thing this phase exists to prevent.
 *
 * A fired stop does not block the phase; it blocks PASSING it. Deposit, prepaid and manager review are
 * all still reachable from the decision bar, which is exactly what the SOP asks for.
 */
export function hardStopsCanPass(ack: HardStopAck | null, allClear: boolean): boolean {
  return ack === 'continue' && allClear;
}
