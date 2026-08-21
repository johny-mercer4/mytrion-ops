/**
 * Phase 10 — the final underwriting decision, the pure half.
 *
 * WHAT THE OLD PANE GOT WRONG. Seven outcomes were rendered as seven identical rows in one
 * radiogroup, so nothing on screen distinguished the five that CLOSE the case forever from the two
 * that hold it open for somebody else. `approve` was preselected, meaning the highest-consequence
 * outcome on the desk was the default. And six of the seven could be recorded with no reason at all,
 * against an SOP that says "record reason and conditions" and "record specific decline reason" in as
 * many words.
 *
 * SO THE OUTCOMES ARE GROUPED BY WHAT THEY DO, not listed. A decision that ends the application and a
 * decision that parks it are different kinds of act, and the reviewer is choosing between kinds
 * before they choose between codes.
 */
import type { IconName } from '@/ds';
import type { VerificationDeskDetail, VerificationFinalDecision } from '@/api/verificationFlow';

/** Which arrangement a deposit/prepaid outcome is. The status column cannot tell them apart. */
export type DepositInstrument = 'deposit_1_1' | 'prepaid';

export interface DecisionOption {
  id: VerificationFinalDecision;
  label: string;
  body: string;
  /**
   * A glyph that says what the outcome IS, not whether it is selected — the same choice
   * `CaseMarkGroup` makes. Selection is carried by `aria-checked` and the tone, which is both more
   * legible on a row of seven and the only option available: the icon subset has
   * `radio_button_checked` but no unchecked counterpart.
   */
  icon: IconName;
  /** False for the two outcomes that keep the case open. */
  closes: boolean;
  tone: 'approve' | 'conditional' | 'hold' | 'decline';
}

/**
 * The seven, in the SOP's own order and with its own words.
 *
 * `manager_review` is labelled "Borderline / exception" because that is what the SOP calls it — the
 * old "Manager review" label described the destination rather than the finding, and the footnote that
 * defines when to use it talks about the finding.
 */
export const DECISION_OPTIONS: readonly DecisionOption[] = [
  {
    id: 'approve',
    icon: 'verified',
    label: 'Approve — standard LOC',
    body: 'Assign the approved credit limit and record the decision.',
    closes: true,
    tone: 'approve',
  },
  {
    id: 'manager_review',
    icon: 'balance',
    label: 'Borderline / exception',
    body: 'A manager may approve a standard or reduced LOC, require a deposit, offer prepaid, request documents, or decline.',
    closes: false,
    tone: 'conditional',
  },
  {
    id: 'deposit_prepaid',
    icon: 'account_balance',
    label: 'Deposit 1:1 / Prepaid',
    body: 'Legitimate applicant, but insufficient for unsecured credit.',
    closes: true,
    tone: 'conditional',
  },
  {
    id: 'pending_docs',
    icon: 'description',
    label: 'Pending documents',
    body: 'Information is missing. Returns to the phase that asked for it once received.',
    closes: false,
    tone: 'hold',
  },
  {
    id: 'declined_customer',
    icon: 'person_remove',
    label: 'Declined by customer',
    body: 'The applicant revoked the application.',
    closes: true,
    tone: 'decline',
  },
  {
    id: 'decline',
    icon: 'remove_circle',
    label: 'Decline',
    body: 'Not approved, and not a confirmed fraud or blacklist match.',
    closes: true,
    tone: 'decline',
  },
  {
    id: 'decline_blacklist',
    icon: 'block',
    label: 'Decline + blacklist',
    body: 'Confirmed blacklist match, or confirmed fraud / intentional misrepresentation.',
    closes: true,
    tone: 'decline',
  },
];

export function decisionOption(id: VerificationFinalDecision): DecisionOption {
  // The list is total over the type, so the fallback is unreachable — it exists so this returns a
  // value rather than `undefined` under `noUncheckedIndexedAccess`.
  return DECISION_OPTIONS.find((o) => o.id === id) ?? DECISION_OPTIONS[0]!;
}

/**
 * Which outcomes must carry a reason. Mirrors `REASON_REQUIRED` on the server.
 *
 * Duplicated deliberately and narrowly: the server is the authority and rejects with a 422 either
 * way, but a reviewer who has typed a decline and clicked should not learn from a toast that the box
 * they skipped was mandatory. Only `approve` is exempt, and only while it stays at or below the
 * recommended limit — see `overRecommended`.
 */
export function reasonRequired(decision: VerificationFinalDecision): boolean {
  return decision !== 'approve';
}

/** The SOP's four triggers for a borderline referral, so the reason starts as a fact not a blank box. */
export const REFERRAL_TRIGGERS: readonly string[] = [
  'Information is inconsistent',
  'Borderline capacity',
  'Unusual profile',
  'An exception is being considered',
];

const num = (raw: unknown): number | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export interface LimitReads {
  requested: number | null;
  recommended: number | null;
  /** What Phase 9 priced, if it ran at all. Null means there is nothing to approve against. */
  assessed: boolean;
}

export function limitReads(detail: VerificationDeskDetail): LimitReads {
  return {
    requested: num(detail.case.requestedLimit),
    recommended: num(detail.risk?.recommendedLimit),
    assessed: Boolean(detail.risk),
  };
}

/**
 * Whether the typed limit exceeds what Phase 9 recommended.
 *
 * The server treats this as an exception needing a recorded reason, and the pane says so before the
 * click rather than after the 422. Null recommended means Phase 9 could not price the tier (the SOP
 * leaves the moderate and weak factors to approved policy) — that is not an exception, it is an
 * absence, and nothing is claimed about it.
 */
export function overRecommended(limit: number | null, recommended: number | null): boolean {
  if (limit === null || recommended === null) return false;
  return limit > recommended;
}

/** How far off the recommendation the typed limit is, as a share. Null when there is nothing to compare. */
export function limitDelta(limit: number | null, recommended: number | null): number | null {
  if (limit === null || recommended === null || recommended === 0) return null;
  return (limit - recommended) / recommended;
}

export interface DecisionDraft {
  decision: VerificationFinalDecision | null;
  limit: string;
  note: string;
  instrument: DepositInstrument | null;
}

/** No preselected decision. The old pane defaulted to `approve` — the costliest possible default. */
export const EMPTY_DECISION: DecisionDraft = {
  decision: null,
  limit: '',
  note: '',
  instrument: null,
};

/**
 * Why the decision cannot be recorded yet, in the reviewer's words, or null when it can.
 *
 * One string rather than a set of booleans because exactly one of these is worth saying at a time and
 * it goes next to the button. Every branch mirrors a server-side 422, so the pane and the API refuse
 * for the same reasons rather than the pane guessing.
 */
export function decisionBlocker(
  draft: DecisionDraft,
  detail: VerificationDeskDetail,
): string | null {
  if (draft.decision === null) return 'Choose an outcome.';
  const limits = limitReads(detail);
  const limit = num(draft.limit);
  const note = draft.note.trim();

  if (draft.decision === 'approve') {
    if (!limits.assessed) {
      return 'Phase 9 has not assessed the risk tier and credit capacity, so there is no recommended limit to approve against.';
    }
    if (limit === null || limit <= 0) return 'Enter the approved credit limit.';
    if (overRecommended(limit, limits.recommended) && note.length === 0) {
      return 'This is above the recommended limit — record the reason for the exception.';
    }
    return null;
  }

  if (draft.decision === 'deposit_prepaid' && draft.instrument === null) {
    return 'Choose the arrangement — a 1:1 deposit or a prepaid account.';
  }

  if (draft.decision === 'pending_docs' && outstandingDocuments(detail) === 0) {
    return 'Request the missing documents first, so the case records what it is waiting for and which phase to return to.';
  }

  if (reasonRequired(draft.decision) && note.length === 0) {
    return draft.decision === 'declined_customer'
      ? 'Record the specific reason the applicant gave.'
      : 'Record the reason.';
  }

  return null;
}

export function outstandingDocuments(detail: VerificationDeskDetail): number {
  return detail.documents.filter((d) => d.status === 'requested').length;
}

/**
 * The phase a documents hold will return to.
 *
 * MIRRORS THE SERVER'S RULE EXACTLY — `documentReturnPhase` takes the newest document row carrying a
 * `requested_in_phase`, whatever its status, and the bundle already arrives newest-first
 * (`order by created_at desc`). Filtering to outstanding rows here instead, or reading from the other
 * end of the list, would make the pane promise a phase the resume does not go to. Null when no
 * request has ever been raised, which is also when this outcome is blocked.
 */
export function returnPhaseLabel(detail: VerificationDeskDetail): string | null {
  const phase = detail.documents.find((d) => d.requestedInPhase)?.requestedInPhase;
  if (!phase) return null;
  return detail.rail.find((p) => p.code === phase)?.label ?? phase;
}

/** Whole dollars — these are policy figures, never exact balances. */
export function decisionMoney(n: number): string {
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}
