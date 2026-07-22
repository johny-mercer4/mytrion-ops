/**
 * Phase 2 desk actions — claim first; then call progress + outcomes (no Saved).
 */
import type { LucideIcon } from 'lucide-react';
import {
  Ear,
  Folder,
  Handshake,
  Lightbulb,
  PauseCircle,
  UserPlus,
  XCircle,
} from 'lucide-react';

export type DeskOutcomeId =
  | 'mark_pending'
  | 'refused'
  | 'out_of_business'
  | 'escalate_citi';

const OUTCOMES: Array<{
  id: DeskOutcomeId;
  label: string;
  hint: string;
  tone: 'ok' | 'warn' | 'danger' | 'muted' | 'accent';
  Icon: LucideIcon;
  needsTwoCall?: boolean;
  needsPendingCap?: boolean;
}> = [
  {
    id: 'refused',
    label: 'Refused',
    hint: 'Needs Call 1 + Call 2 · then close',
    tone: 'danger',
    Icon: XCircle,
    needsTwoCall: true,
  },
  {
    id: 'mark_pending',
    label: 'Offer out',
    hint: 'Waiting on client · ≤15% cap (min 1)',
    tone: 'warn',
    Icon: PauseCircle,
    needsPendingCap: true,
  },
  {
    id: 'out_of_business',
    label: 'Out of business',
    hint: 'Close as OoB',
    tone: 'muted',
    Icon: XCircle,
  },
  {
    id: 'escalate_citi',
    label: 'Escalate CITI',
    hint: 'Send to CITI Folder',
    tone: 'danger',
    Icon: Folder,
  },
];

export function CaseDeskActions({
  busy,
  canClaim,
  canMarkPending,
  unassigned,
  twoCall,
  notes,
  onNotes,
  onClaim,
  onLogListen,
  onLogSolution,
  onOutcome,
}: {
  busy: boolean;
  canClaim: boolean;
  canMarkPending: boolean;
  unassigned: boolean;
  twoCall: { listen: boolean; solution: boolean };
  notes: string;
  onNotes: (v: string) => void;
  onClaim: () => void;
  onLogListen: () => void;
  onLogSolution: () => void;
  onOutcome: (id: DeskOutcomeId) => void;
}) {
  if (unassigned) {
    return (
      <div className="cs-ret-desk-actions">
        <button
          type="button"
          className="cs-ret-act-btn is-claim"
          disabled={busy || !canClaim}
          title={!canClaim ? 'Daily 40-deal cap reached' : 'Assign this case to you'}
          onClick={onClaim}
        >
          <UserPlus size={18} strokeWidth={2.2} aria-hidden />
          <span>
            <strong>Claim case</strong>
            <em>
              {canClaim
                ? 'Required before calls or status updates'
                : 'Daily cap reached'}
            </em>
          </span>
        </button>
        <p className="cs-ret-act-hint" style={{ marginTop: 10 }}>
          Unassigned cases stay in Unassigned until someone claims them. Calls and
          outcomes unlock after claim.
        </p>
      </div>
    );
  }

  return (
    <div className="cs-ret-desk-actions">
      <div className="cs-ret-act-block">
        <div className="cs-ret-act-label">Call progress</div>
        <p className="cs-ret-act-hint">
          Log Call 1 (listen) and Call 2 (solution) before Refused. Channel is recorded
          automatically as RingCentral.
        </p>
        <div className="cs-ret-call-grid">
          <button
            type="button"
            className={`cs-ret-act-btn is-listen${twoCall.listen ? ' is-done' : ''}`}
            disabled={busy}
            onClick={onLogListen}
          >
            <Ear size={18} strokeWidth={2.2} aria-hidden />
            <span>
              <strong>Call 1 · Listen</strong>
              <em>{twoCall.listen ? 'Logged ✓' : 'Understand the issue'}</em>
            </span>
          </button>
          <button
            type="button"
            className={`cs-ret-act-btn is-solution${twoCall.solution ? ' is-done' : ''}`}
            disabled={busy}
            onClick={onLogSolution}
          >
            <Lightbulb size={18} strokeWidth={2.2} aria-hidden />
            <span>
              <strong>Call 2 · Solution</strong>
              <em>{twoCall.solution ? 'Logged ✓' : 'Present the offer'}</em>
            </span>
          </button>
        </div>
        <label className="cs-ret-notes">
          Notes (optional)
          <input
            value={notes}
            onChange={(e) => onNotes(e.currentTarget.value)}
            placeholder="Applies to the next call log or status update…"
          />
        </label>
      </div>

      <div className="cs-ret-act-block">
        <div className="cs-ret-act-label">Set status</div>
        <p className="cs-ret-act-hint">Choose the Retention outcome for this case.</p>
        <div className="cs-ret-outcome-grid">
          {OUTCOMES.map((o) => {
            const blockedTwoCall = o.needsTwoCall && !(twoCall.listen && twoCall.solution);
            const blockedPending = o.needsPendingCap && !canMarkPending;
            const disabled = busy || blockedTwoCall || blockedPending;
            return (
              <button
                key={o.id}
                type="button"
                className={`cs-ret-act-btn is-${o.tone}`}
                disabled={disabled}
                title={
                  blockedTwoCall
                    ? 'Refused unlocks after Call 1 (listen) and Call 2 (solution) are logged'
                    : blockedPending
                      ? 'Offer-out portfolio at cap — resolve some offers first'
                      : o.hint
                }
                onClick={() => onOutcome(o.id)}
              >
                <o.Icon size={17} strokeWidth={2.2} aria-hidden />
                <span>
                  <strong>{o.label}</strong>
                  <em>{o.hint}</em>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="cs-ret-act-foot">
        <Handshake size={14} strokeWidth={2.2} aria-hidden />
        Working this case · each status sets the next timer or closes the case
      </div>
    </div>
  );
}
