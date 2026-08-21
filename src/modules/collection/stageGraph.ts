/**
 * The Zoho Blueprint on `Collection_Cases`, as data.
 *
 * READ FROM ZOHO, NOT INVENTED. Every edge below is one of the 39 connections returned by
 * `GET settings/blueprints/6227679000153907226` on 2026-08-20 — transition label, precedence and
 * target state verbatim. Where the labels look odd they are quoted as Zoho has them: the states
 * spell "NC - Attempt 1" with a hyphen while the transition spells it with an em dash, and
 * "Debt more or less than 8,000 USD" is Zoho's typo for "more than".
 *
 * WHY THIS EXISTS. Collection agents are moving off the CRM, and the Blueprint is the one piece
 * of the CRM that actually shapes their day: from Connected you may go to a plan, to an agency,
 * or to closed — and nowhere else. The desk let any stage be set from any stage, which is not
 * parity, it is the loss of the only guard rail the process had.
 *
 * Two thresholds in here are REAL, unlike everything in `DESK_POLICY`: the Legal Action split at
 * $8,000 (small claims below, civil court above) is a business rule written into the Blueprint.
 *
 * `Connected` is reachable from all fifteen non-initial states — a debtor who finally picks up
 * re-enters the process wherever the case had drifted to. That edge is what makes the graph a
 * graph rather than a funnel, and it is why "advance to the next stage in a list" was always a
 * fiction.
 */
import type { CollectionStage } from '../../db/schema/collection.js';

export interface StageTransition {
  /** Zoho's own label for the move. This is the wording collectors already know. */
  label: string;
  to: CollectionStage;
  /** Zoho's ordering within the source state; lower shows first. */
  precedence: number;
  /**
   * Set when the Blueprint gates the move on something other than the collector's judgement.
   * Advisory: the desk shows it and orders by it, and does not hard-block, because the debt
   * figure moves under the case between the decision and the click.
   */
  hint?: string;
}

/** Every move the Blueprint allows, keyed by the stage the case is on now. */
export const STAGE_TRANSITIONS: Readonly<Record<CollectionStage, readonly StageTransition[]>> = {
  intake: [
    { label: 'NC — Attempt 1', to: 'nc_attempt_1', precedence: 1 },
    { label: 'Connected', to: 'connected', precedence: 2 },
  ],
  nc_attempt_1: [
    { label: 'no response', to: 'nc_attempt_2', precedence: 1 },
    { label: 'Connected', to: 'connected', precedence: 4 },
  ],
  nc_attempt_2: [
    { label: 'no response 2', to: 'nc_attempt_3', precedence: 1 },
    { label: 'Connected', to: 'connected', precedence: 4 },
  ],
  nc_attempt_3: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'no response 3', to: 'usps_letter', precedence: 3 },
  ],
  usps_letter: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'no response 4', to: 'with_agency', precedence: 2 },
  ],
  connected: [
    { label: 'Payment Plan', to: 'payment_plan', precedence: 1 },
    { label: 'Refuses', to: 'with_agency', precedence: 2 },
    { label: 'Full payment received', to: 'closed_successfully', precedence: 3 },
  ],
  payment_plan: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'Missed payment', to: 'reconnect_attempt', precedence: 2 },
    { label: 'Fully Paid', to: 'closed_successfully', precedence: 3 },
  ],
  reconnect_attempt: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'Agrees to continue', to: 'payment_plan', precedence: 2 },
    { label: 'Refuses again', to: 'failed_promise', precedence: 3 },
  ],
  failed_promise: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'With Agency', to: 'with_agency', precedence: 2 },
  ],
  with_agency: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'All agencies failed', to: 'skip_tracing', precedence: 2 },
    // A self-edge: the case stays With Agency and moves to the NEXT agency on the list.
    { label: '120 days · no payment → pick next agency', to: 'with_agency', precedence: 3 },
    { label: 'Debtor pays', to: 'closed_successfully', precedence: 4 },
  ],
  skip_tracing: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'Legal Action', to: 'legal_action', precedence: 2 },
  ],
  legal_action: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    {
      label: 'Debt less than 8,000 USD',
      to: 'small_claims',
      precedence: 2,
      hint: 'Small claims is for debts under $8,000',
    },
    {
      // Zoho's label reads "more or less than", which is a typo for "more than" — the sibling
      // edge above already covers "less". Reworded here; the routing is unchanged.
      label: 'Debt more than 8,000 USD',
      to: 'civil_court',
      precedence: 3,
      hint: 'Civil court is for debts of $8,000 and over',
    },
  ],
  small_claims: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'win', to: 'closed_successfully', precedence: 2 },
    { label: 'lost', to: 'case_lost', precedence: 3 },
  ],
  civil_court: [
    { label: 'Connected', to: 'connected', precedence: 1 },
    { label: 'win', to: 'closed_successfully', precedence: 2 },
    { label: 'lost', to: 'case_lost', precedence: 3 },
  ],
  closed_successfully: [{ label: 'Connected', to: 'connected', precedence: 1 }],
  case_lost: [{ label: 'Connected', to: 'connected', precedence: 1 }],
};

/** The court the Blueprint routes a debt of this size to. The $8,000 line is Zoho's, not ours. */
export const LEGAL_SMALL_CLAIMS_CEILING_USD = 8_000;

/** The moves offered from a stage, in Zoho's own order. */
export function transitionsFrom(stage: CollectionStage): readonly StageTransition[] {
  return STAGE_TRANSITIONS[stage] ?? [];
}

/** Whether the Blueprint allows this move. A self-edge counts — With Agency has a real one. */
export function canTransition(from: CollectionStage, to: CollectionStage): boolean {
  return transitionsFrom(from).some((t) => t.to === to);
}

/** The transition that produces this move, for the timeline entry. Null when it is not allowed. */
export function transitionFor(
  from: CollectionStage,
  to: CollectionStage,
): StageTransition | null {
  return transitionsFrom(from).find((t) => t.to === to) ?? null;
}

/**
 * Which court a debt of this size belongs in, per the Blueprint's own split. Advisory — the desk
 * shows it beside the two Legal Action moves rather than blocking the other one, because the
 * remaining balance changes under the case and a collector may know something the figure doesn't.
 */
export function suggestedCourt(remaining: number): 'small_claims' | 'civil_court' {
  return remaining < LEGAL_SMALL_CLAIMS_CEILING_USD ? 'small_claims' : 'civil_court';
}
