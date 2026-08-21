/**
 * Phase 10's decision rules.
 *
 * The blocker is the interesting half: every branch mirrors a server-side 422, so a gap here is a
 * reviewer learning from a toast what the pane should have told them before they clicked.
 */
import { describe, expect, it } from 'vitest';
import type { VerificationDeskDetail } from '@/api/verificationFlow';
import {
  DECISION_OPTIONS,
  EMPTY_DECISION,
  decisionBlocker,
  decisionOption,
  limitDelta,
  limitReads,
  outstandingDocuments,
  overRecommended,
  reasonRequired,
  returnPhaseLabel,
  type DecisionDraft,
} from './caseDecision';

function detail(over: Partial<Record<string, unknown>> = {}): VerificationDeskDetail {
  return {
    case: { requestedLimit: '5000', phaseCode: 'p10_decision' },
    risk: { recommendedLimit: '4000', riskTier: 'strong' },
    documents: [],
    rail: [{ code: 'p6_credit_banking', label: 'Credit & banking' }],
    ...over,
  } as unknown as VerificationDeskDetail;
}

const draft = (over: Partial<DecisionDraft> = {}): DecisionDraft => ({ ...EMPTY_DECISION, ...over });

describe('the seven outcomes', () => {
  it('covers every decision the API accepts, once each', () => {
    const ids = DECISION_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'approve',
        'manager_review',
        'deposit_prepaid',
        'pending_docs',
        'declined_customer',
        'decline',
        'decline_blacklist',
      ]),
    );
  });

  it('marks exactly the two non-terminal outcomes as keeping the case open', () => {
    const open = DECISION_OPTIONS.filter((o) => !o.closes).map((o) => o.id);
    expect(open.sort()).toEqual(['manager_review', 'pending_docs']);
  });

  it('requires a reason for everything except approve', () => {
    for (const option of DECISION_OPTIONS) {
      expect(reasonRequired(option.id)).toBe(option.id !== 'approve');
    }
  });

  it('resolves an option for every id', () => {
    for (const option of DECISION_OPTIONS) {
      expect(decisionOption(option.id).label).toBe(option.label);
    }
  });
});

describe('nothing is preselected', () => {
  it('starts with no decision — the old pane defaulted to approve', () => {
    expect(EMPTY_DECISION.decision).toBeNull();
    expect(decisionBlocker(EMPTY_DECISION, detail())).toBe('Choose an outcome.');
  });
});

describe('approve', () => {
  it('refuses when Phase 9 never assessed the case', () => {
    expect(decisionBlocker(draft({ decision: 'approve', limit: '4000' }), detail({ risk: null })))
      .toMatch(/Phase 9 has not assessed/);
  });

  it('refuses a missing or non-positive limit', () => {
    expect(decisionBlocker(draft({ decision: 'approve' }), detail())).toMatch(/Enter the approved/);
    expect(decisionBlocker(draft({ decision: 'approve', limit: '0' }), detail())).toMatch(
      /Enter the approved/,
    );
  });

  it('allows the recommended limit with no note', () => {
    expect(decisionBlocker(draft({ decision: 'approve', limit: '4000' }), detail())).toBeNull();
  });

  it('allows a REDUCED limit with no note — that is a standard call, not an exception', () => {
    expect(decisionBlocker(draft({ decision: 'approve', limit: '2500' }), detail())).toBeNull();
  });

  it('requires a reason above the recommended limit', () => {
    expect(decisionBlocker(draft({ decision: 'approve', limit: '4001' }), detail())).toMatch(
      /above the recommended limit/,
    );
    expect(
      decisionBlocker(draft({ decision: 'approve', limit: '4001', note: 'Manager exception' }), detail()),
    ).toBeNull();
  });

  it('claims no exception when the tier had no priceable factor', () => {
    // A null recommended limit is an ABSENCE, not a ceiling of zero — the SOP leaves the moderate
    // and weak factors to approved policy, so a tier can be assessed with nothing to compare.
    const noFactor = detail({ risk: { recommendedLimit: null, riskTier: 'weak' } });
    expect(overRecommended(9999, null)).toBe(false);
    expect(decisionBlocker(draft({ decision: 'approve', limit: '9999' }), noFactor)).toBeNull();
  });
});

describe('deposit / prepaid', () => {
  it('requires the arrangement before the reason', () => {
    expect(decisionBlocker(draft({ decision: 'deposit_prepaid', note: 'why' }), detail())).toMatch(
      /1:1 deposit or a prepaid account/,
    );
  });

  it('requires the reason and conditions once the arrangement is chosen', () => {
    expect(
      decisionBlocker(draft({ decision: 'deposit_prepaid', instrument: 'prepaid' }), detail()),
    ).toMatch(/Record the reason/);
    expect(
      decisionBlocker(
        draft({ decision: 'deposit_prepaid', instrument: 'prepaid', note: 'Thin file' }),
        detail(),
      ),
    ).toBeNull();
  });
});

describe('pending documents', () => {
  const requested = [
    { id: 'd1', status: 'requested', docType: 'bank_statement', requestedInPhase: 'p6_credit_banking' },
  ];

  it('refuses with nothing outstanding — there would be no phase to return to', () => {
    expect(decisionBlocker(draft({ decision: 'pending_docs', note: 'n' }), detail())).toMatch(
      /Request the missing documents first/,
    );
  });

  it('allows it once a request exists, and still wants a reason', () => {
    const d = detail({ documents: requested });
    expect(decisionBlocker(draft({ decision: 'pending_docs' }), d)).toMatch(/Record the reason/);
    expect(decisionBlocker(draft({ decision: 'pending_docs', note: 'Missing page 3' }), d)).toBeNull();
    expect(outstandingDocuments(d)).toBe(1);
  });

  it('names the phase the hold returns to', () => {
    expect(returnPhaseLabel(detail({ documents: requested }))).toBe('Credit & banking');
  });

  it('reads the NEWEST request, which is the rule the server applies', () => {
    // The bundle arrives newest-first. Taking the other end would promise a phase the resume does
    // not go to.
    const two = detail({
      documents: [
        { id: 'new', status: 'requested', docType: 'other', requestedInPhase: 'p8_highway' },
        { id: 'old', status: 'received', docType: 'other', requestedInPhase: 'p6_credit_banking' },
      ],
      rail: [
        { code: 'p6_credit_banking', label: 'Credit & banking' },
        { code: 'p8_highway', label: 'Highway review' },
      ],
    });
    expect(returnPhaseLabel(two)).toBe('Highway review');
  });

  it('has no return phase when nothing was ever requested', () => {
    expect(returnPhaseLabel(detail())).toBeNull();
  });
});

describe('declines', () => {
  it('asks a customer-revoked decline for the applicant’s own reason', () => {
    expect(decisionBlocker(draft({ decision: 'declined_customer' }), detail())).toMatch(
      /specific reason the applicant gave/,
    );
  });

  it('requires a reason on both decline arms', () => {
    expect(decisionBlocker(draft({ decision: 'decline' }), detail())).toMatch(/Record the reason/);
    expect(decisionBlocker(draft({ decision: 'decline_blacklist' }), detail())).toMatch(
      /Record the reason/,
    );
    expect(
      decisionBlocker(draft({ decision: 'decline_blacklist', note: 'Confirmed fraud' }), detail()),
    ).toBeNull();
  });
});

describe('limit reads', () => {
  it('reports both figures and whether Phase 9 ran', () => {
    expect(limitReads(detail())).toEqual({ requested: 5000, recommended: 4000, assessed: true });
    expect(limitReads(detail({ risk: null }))).toEqual({
      requested: 5000,
      recommended: null,
      assessed: false,
    });
  });

  it('measures the overage as a share, and refuses to divide by zero', () => {
    expect(limitDelta(5000, 4000)).toBeCloseTo(0.25);
    expect(limitDelta(5000, 0)).toBeNull();
    expect(limitDelta(null, 4000)).toBeNull();
  });
});
