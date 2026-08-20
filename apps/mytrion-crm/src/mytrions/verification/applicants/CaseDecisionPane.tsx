/**
 * Phase 10 — the final underwriting decision.
 *
 * WHY THIS REPLACES `flow/ReviewPanes.tsx`'s `DecisionPane`. That one was built from inline
 * `style={s('…')}` strings, so the last screen of the flow spoke a different visual language from
 * every `.va-*` pane before it. But the shape was the real problem: seven outcomes as seven identical
 * rows, `approve` preselected, and one optional note shared between them.
 *
 * THE THREE THINGS THIS PANE HAS TO DO, in the order the reviewer does them:
 *
 *  1. Show what is being decided — the underwriting summary the SOP enumerates, and the three limits
 *     that matter. A decision recorded without reading them is the failure mode.
 *  2. Make the KIND of outcome legible before the code. Five of the seven close the case forever; two
 *     hold it for somebody else. That grouping is the pane's main structural claim.
 *  3. Ask for exactly what the chosen outcome requires, and nothing else. The limit box only exists
 *     for the two outcomes that carry a limit; the instrument picker only for the one that needs it.
 *
 * WHY THE BLOCKER IS A SENTENCE, NOT A DISABLED BUTTON. Every refusal here mirrors a server-side 422,
 * and a greyed button with no explanation on the last screen of a ten-phase flow is the worst place to
 * make somebody guess. `decisionBlocker` returns the reason; this renders it next to the control.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Icon, Input } from '@/ds';
import type { VerificationDeskDetail, VerificationFinalDecision } from '@/api/verificationFlow';
import { UnderwritingSummary } from '../flow/UnderwritingSummary';
import { useRovingRadio } from '../../_shared/useRovingRadio';
import { CaseMarkGroup, type MarkOption } from './CaseMarkGroup';
import {
  DECISION_OPTIONS,
  EMPTY_DECISION,
  REFERRAL_TRIGGERS,
  decisionBlocker,
  decisionMoney,
  decisionOption,
  limitDelta,
  limitReads,
  outstandingDocuments,
  overRecommended,
  reasonRequired,
  returnPhaseLabel,
  type DecisionDraft,
  type DepositInstrument,
} from './caseDecision';

/** Through `CaseMarkGroup` rather than hand-rolled markup — it is a two-option radiogroup, which is
 *  exactly what that component is, and it brings the roving arrow keys and the tone styling with it. */
const INSTRUMENTS: ReadonlyArray<MarkOption<DepositInstrument>> = [
  {
    id: 'deposit_1_1',
    label: 'Deposit 1:1',
    icon: 'account_balance',
    tone: 'warn',
    hint: 'Secured against a deposit matching the line',
  },
  {
    id: 'prepaid',
    label: 'Prepaid',
    icon: 'payments',
    tone: 'warn',
    hint: 'Funded up front — no credit extended',
  },
];

const num = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export function CaseDecisionPane({
  detail,
  busy,
  disabled = false,
  onDecide,
  onGoToPhase,
}: {
  detail: VerificationDeskDetail;
  busy: boolean;
  /**
   * The reviewer may not act at all — a locked or decided case. SEPARATE from `busy`, which means a
   * request is in flight: conflating them made a locked case read "Recording…" forever.
   */
  disabled?: boolean;
  onDecide: (body: {
    decision: VerificationFinalDecision;
    approvedLimit?: number;
    note?: string;
    instrument?: DepositInstrument;
  }) => void;
  /** Requesting the missing documents happens on the phase that needs them, so the pane offers the jump. */
  onGoToPhase: (code: string) => void;
}) {
  const [draft, setDraft] = useState<DecisionDraft>(EMPTY_DECISION);
  /** Two-step confirm for the outcomes that cannot be taken back. */
  const [arming, setArming] = useState(false);

  const limits = useMemo(() => limitReads(detail), [detail]);
  const blocker = decisionBlocker(draft, detail);
  const chosen = draft.decision === null ? null : decisionOption(draft.decision);
  const limit = num(draft.limit);
  const over = draft.decision === 'approve' && overRecommended(limit, limits.recommended);
  const wantsLimit = draft.decision === 'approve' || draft.decision === 'deposit_prepaid';
  /**
   * The typed limit is KEPT when the reviewer switches outcome — losing it would punish a change of
   * mind — but it is only SHOWN on the two outcomes that carry one. It read "APPROVING $9,000" on a
   * Decline + blacklist, which is a claim the decision does not make.
   */
  const shownLimit = wantsLimit ? limit : null;
  const delta = over ? limitDelta(limit, limits.recommended) : null;
  const outstanding = outstandingDocuments(detail);
  const returnPhase = returnPhaseLabel(detail);

  const set = (patch: Partial<DecisionDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }));
    setArming(false);
  };

  const roving = useRovingRadio(
    DECISION_OPTIONS.map((o) => o.id),
    draft.decision ?? ('' as VerificationFinalDecision),
    (next) => set({ decision: next }),
  );

  // `deposit_prepaid` sets the SECURED amount, which is what "1:1" is a ratio of — the old pane
  // offered the box on approve alone, so a deposit was recorded with no figure anywhere.
  const destructive = draft.decision === 'decline' || draft.decision === 'decline_blacklist';
  const noteRequired = draft.decision !== null && (reasonRequired(draft.decision) || over);

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Final underwriting decision</h3>
        <span className="va-pane-note">End of the new-applicant flow</span>
      </div>

      <UnderwritingSummary detail={detail} />

      {/* THE THREE LIMITS, ALWAYS ALL THREE. Requested is what they asked for, recommended is what
          Phase 9 priced, approved is what this screen decides — and the gap between the first two is
          the single most useful thing on the pane. */}
      <div className="va-figs">
        <span className="va-fig">
          <span className="t-eyebrow">Requested</span>
          <span className="va-fig-v" data-empty={limits.requested === null ? true : undefined}>
            {limits.requested === null ? '—' : decisionMoney(limits.requested)}
          </span>
        </span>
        <span className="va-fig">
          <span className="t-eyebrow">Recommended</span>
          <span className="va-fig-v" data-empty={limits.recommended === null ? true : undefined}>
            {limits.recommended === null ? '—' : decisionMoney(limits.recommended)}
          </span>
          <span className="va-fig-hint">
            {limits.assessed
              ? `Phase 9 · ${detail.risk?.riskTier ?? 'tier not recorded'}`
              : 'Phase 9 not assessed'}
          </span>
        </span>
        <span className="va-fig">
          <span className="t-eyebrow">{draft.decision === 'deposit_prepaid' ? 'Securing' : 'Approving'}</span>
          <span className="va-fig-v" data-empty={shownLimit === null ? true : undefined}>
            {shownLimit === null ? '—' : decisionMoney(shownLimit)}
          </span>
          {over && delta !== null ? (
            <span className="va-fig-hint">{`${Math.round(delta * 100)}% over recommended`}</span>
          ) : null}
        </span>
      </div>

      {/* GROUPED BY WHAT THE OUTCOME DOES. The heading is the load-bearing part: it tells the reviewer
          which of these end the application before they read the seven labels. */}
      <div className="va-decide-groups" role="radiogroup" aria-label="Final decision">
        {(
          [
            { closes: true, title: 'Closes the case', hint: 'Final — the application ends here' },
            {
              closes: false,
              title: 'Keeps the case open',
              hint: 'Hands it on — someone picks it up from here',
            },
          ] as const
        ).map((group) => (
          <div className="va-decide-group" key={group.title}>
            <div className="va-decide-group-head">
              <span className="t-eyebrow">{group.title}</span>
              <span className="va-decide-group-hint">{group.hint}</span>
            </div>
            {DECISION_OPTIONS.filter((o) => o.closes === group.closes).map((option) => {
              const on = draft.decision === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="va-decide-option"
                  data-tone={option.tone}
                  disabled={disabled}
                  {...roving(option.id)}
                  onClick={() => set({ decision: option.id })}
                >
                  <Icon name={option.icon} size="sm" className="va-decide-option-glyph" />
                  <span className="va-decide-option-copy">
                    <span className="va-decide-option-label">{option.label}</span>
                    <span className="va-decide-option-body">{option.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* WHAT THE CHOSEN OUTCOME NEEDS. Nothing below appears until an outcome is chosen, because
          every one of these fields belongs to a subset of the seven. */}
      {chosen ? (
        <div className="va-decide-detail" data-tone={chosen.tone}>
          {wantsLimit ? (
            <div className="va-field-group">
              <label className="va-field-label va-field-label-badged" htmlFor="final-limit">
                {draft.decision === 'approve' ? 'Approved credit limit' : 'Secured line amount'}
                <span className="va-field-unit"> · USD</span>
                {draft.decision === 'approve' ? (
                  <Badge intent="neutral" size="sm">
                    Required
                  </Badge>
                ) : null}
              </label>
              <div className="va-decide-limit">
                <Input
                  id="final-limit"
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.limit}
                  disabled={disabled}
                  fullWidth
                  onChange={(e) => set({ limit: e.currentTarget.value })}
                />
                {limits.recommended !== null && draft.decision === 'approve' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => set({ limit: String(limits.recommended) })}
                  >
                    Use recommended
                  </Button>
                ) : null}
              </div>
              <span className="va-field-hint">
                {draft.decision === 'approve'
                  ? 'A standard LOC is the recommended limit. Anything above it is an exception and needs a reason.'
                  : 'A 1:1 deposit secures a line of the same size. Leave blank for prepaid with no line.'}
              </span>
            </div>
          ) : null}

          {/* AN EXCEPTION, NAMED AS ONE. This is the sentence that keeps an over-capacity approval off
              the "standard LOC" label it would otherwise carry into the summary. */}
          {over ? (
            <div className="va-banner" data-tone="warning">
              <Icon name="warning" size="sm" className="va-banner-glyph" />
              <div className="va-banner-text">
                <span className="va-banner-title">Above the recommended limit</span>
                <span className="va-banner-body">
                  {`Phase 9 priced ${decisionMoney(limits.recommended ?? 0)} from the recorded cash flow. Approving more is a management exception — it is recorded as one, and the reason below becomes mandatory.`}
                </span>
              </div>
            </div>
          ) : null}

          {draft.decision === 'deposit_prepaid' ? (
            <div className="va-field-group">
              <span className="va-field-label va-field-label-badged">
                Arrangement
                <Badge intent="neutral" size="sm">
                  Required
                </Badge>
              </span>
              <CaseMarkGroup
                ariaLabel="Arrangement"
                options={INSTRUMENTS}
                value={draft.instrument}
                disabled={disabled}
                onChange={(next) => set({ instrument: next })}
              />
              <span className="va-field-hint">
                The status column records both as one outcome, so which arrangement this is only
                survives if it is recorded here.
              </span>
            </div>
          ) : null}

          {/* THE ONE OUTCOME WITH A MECHANISM BEHIND IT. Pending documents is not a note — it is a
              hold that has to know what it is waiting for, or nothing can resume it. */}
          {draft.decision === 'pending_docs' ? (
            outstanding === 0 ? (
              <div className="va-ask">
                <span className="va-aside-note">
                  Nothing is outstanding on this case. Request the missing documents on the phase that
                  needs them — the hold returns there once they arrive, and with no request there is
                  no phase to return to and no record of what was asked for.
                </span>
                <div className="va-ask-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="restart_alt"
                    disabled={disabled}
                    onClick={() => onGoToPhase(detail.case.phaseCode)}
                  >
                    Go to the current phase
                  </Button>
                </div>
              </div>
            ) : (
              <div className="va-banner">
                <Icon name="description" size="sm" className="va-banner-glyph" />
                <div className="va-banner-text">
                  <span className="va-banner-title">
                    {`${outstanding} document${outstanding === 1 ? '' : 's'} outstanding`}
                  </span>
                  <span className="va-banner-body">
                    {returnPhase
                      ? `Returns to ${returnPhase} once received.`
                      : 'Returns to the phase that raised the request once received.'}
                  </span>
                  <ul className="va-banner-list">
                    {detail.documents
                      .filter((d) => d.status === 'requested')
                      .map((d) => (
                        <li key={d.id}>{d.label ?? d.docType}</li>
                      ))}
                  </ul>
                </div>
              </div>
            )
          ) : null}

          {/* WHAT DECLINE + BLACKLIST ACTUALLY DOES, before it is done. It writes to two ban lists and
              tells Collections — none of which is recoverable from this screen, so it is stated. */}
          {draft.decision === 'decline_blacklist' ? (
            <div className="va-banner" data-tone="danger">
              <Icon name="block" size="sm" className="va-banner-glyph" />
              <div className="va-banner-text">
                <span className="va-banner-title">This bans the applicant, not just this case</span>
                <span className="va-banner-body">
                  Every identifier on the case — name, EIN, phone, email and address — is added to
                  Octane&apos;s blacklist and to the shared credit-platform ban list, and Collections
                  is informed. The reason below is stored on the entry and is what the next screening
                  will show.
                </span>
              </div>
            </div>
          ) : null}

          {/* THE SOP'S FOUR TRIGGERS, as a starting point rather than a blank box. A referral that
              does not say what is being referred is not a referral. */}
          {draft.decision === 'manager_review' ? (
            <div className="va-field-group">
              <span className="va-field-label">What is being referred</span>
              <div className="va-segs">
                {REFERRAL_TRIGGERS.map((trigger) => (
                  <button
                    key={trigger}
                    type="button"
                    className="va-seg"
                    disabled={disabled}
                    onClick={() =>
                      set({
                        note: draft.note.trim() === '' ? `${trigger}: ` : draft.note,
                      })
                    }
                  >
                    {trigger}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="va-field-group">
            <label className="va-field-label va-field-label-badged" htmlFor="final-note">
              {draft.decision === 'deposit_prepaid' ? 'Reason and conditions' : 'Reason'}
              {noteRequired ? (
                <Badge intent="neutral" size="sm">
                  Required
                </Badge>
              ) : null}
            </label>
            <textarea
              id="final-note"
              className="va-textarea"
              rows={3}
              value={draft.note}
              disabled={disabled}
              onChange={(e) => set({ note: e.currentTarget.value })}
            />
          </div>
        </div>
      ) : null}

      <div className="va-save">
        <Button
          variant={destructive ? 'danger' : 'primary'}
          disabled={busy || disabled || blocker !== null}
          icon={arming ? 'warning' : 'gavel'}
          onClick={() => {
            if (draft.decision === null) return;
            if (destructive && !arming) {
              setArming(true);
              return;
            }
            setArming(false);
            onDecide({
              decision: draft.decision,
              ...(wantsLimit && limit !== null ? { approvedLimit: limit } : {}),
              ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
              ...(draft.instrument ? { instrument: draft.instrument } : {}),
            });
          }}
        >
          {arming ? 'Confirm — this cannot be undone' : busy ? 'Recording…' : 'Record final decision'}
        </Button>
        {blocker ? <span className="va-save-hint">{blocker}</span> : null}
        {!blocker && chosen && !chosen.closes ? (
          <span className="va-save-hint">The case stays open — this does not end the application.</span>
        ) : null}
      </div>
    </div>
  );
}
