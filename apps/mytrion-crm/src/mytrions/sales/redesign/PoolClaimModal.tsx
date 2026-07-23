/**
 * Open Pool claim modal — reason + confirm; assigns instantly (Zoho + Kanban New).
 * Visual hierarchy: deal identity → status badges → reason → confirm → primary Claim.
 */
import type { ChangeEvent, MouseEvent } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { fmtGal } from './RetentionBoardUi';
import {
  breachSeverity,
  freqLabel,
  type RetentionCaseRow,
} from './retentionData';

function quietTone(c: RetentionCaseRow): 'ok' | 'warn' | 'danger' {
  const sev = breachSeverity(c);
  if (sev >= 14) return 'danger';
  if (sev >= 3 || (c.daysInactive ?? 0) > (c.thresholdDays ?? 0)) return 'warn';
  return 'ok';
}

/** Compact quiet label for badges (full sentence is too long in a chip). */
function quietBadge(c: RetentionCaseRow): string {
  const days = c.daysInactive ?? 0;
  const thr = c.thresholdDays;
  return thr ? `${days}d · every ${thr}d` : `${days}d`;
}

function cycleTone(count: number): 'ok' | 'warn' | 'danger' {
  if (count >= 3) return 'danger';
  if (count === 2) return 'warn';
  return 'ok';
}

export function PoolClaimModal({
  mode,
  claimIds,
  singleSummary,
  reason,
  confirm,
  submitting,
  onReason,
  onConfirm,
  onClose,
  onSubmit,
}: {
  mode: 'single' | 'bulk';
  claimIds: string[];
  singleSummary: RetentionCaseRow | null;
  reason: string;
  confirm: boolean;
  submitting: boolean;
  onReason: (v: string) => void;
  onConfirm: (v: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const reasonOk = reason.trim().length > 0;
  const canSubmit = confirm && reasonOk && !submitting && claimIds.length > 0;
  const stop = (e: MouseEvent): void => e.stopPropagation();
  const dealTitle =
    mode === 'single'
      ? singleSummary?.companyName || singleSummary?.carrierId || 'deal'
      : `${claimIds.length} deals`;

  return (
    <div className="ss-scrim" style={{ zIndex: 140 }} onClick={onClose}>
      <div
        className="ss-pool-modal"
        onClick={stop}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-pool-claim-title"
      >
        <div className="ss-pool-modal-head">
          <div className="ss-pool-modal-ico" aria-hidden>
            <Icon name="assign" size={19} />
          </div>
          <div style={s('flex:1;min-width:0')}>
            <div className="ss-pool-modal-kicker">
              <span className="ss-pool-pill is-pool">Open Pool</span>
              <span className="ss-pool-pill is-instant">Instant assign</span>
              <span className="ss-pool-pill is-limit">Max 2 / day</span>
            </div>
            <div id="ss-pool-claim-title" className="ss-pool-modal-title">
              Claim · {dealTitle}
            </div>
            <div className="ss-pool-modal-sub">
              {mode === 'bulk'
                ? `One reason covers all ${claimIds.length} selected deals.`
                : 'Add a short reason, confirm, then claim into your New column.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ss-ico-btn"
            aria-label="Close"
            disabled={submitting}
            style={s(
              'width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center',
            )}
          >
            <Icon name="close" size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="ss-pool-modal-body">
          {singleSummary ? (
            <div className="ss-pool-modal-summary">
              <div className="ss-pool-modal-summary-top">
                <div className="ss-pool-modal-company">{singleSummary.companyName || '—'}</div>
                <span className="ss-pool-mono ss-pool-carrier">{singleSummary.carrierId}</span>
              </div>
              <div className="ss-pool-badge-row" aria-label="Deal status">
                <span className={`ss-pool-stat is-${quietTone(singleSummary)}`} title="Days since last fuel vs expected cadence">
                  <em>Quiet</em>
                  {quietBadge(singleSummary)}
                </span>
                <span className={`ss-pool-stat is-${cycleTone(singleSummary.assignmentCount)}`}>
                  <em>Cycle</em>
                  {singleSummary.assignmentCount}/3
                </span>
                <span className="ss-pool-stat is-neutral">
                  <em>90d fuel</em>
                  {singleSummary.gallons90d != null ? `${fmtGal(singleSummary.gallons90d)} gal` : '—'}
                </span>
                {singleSummary.transactionFrequency ? (
                  <span className="ss-pool-stat is-accent">
                    <em>Cadence</em>
                    {freqLabel(singleSummary.transactionFrequency)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : mode === 'bulk' ? (
            <div className="ss-pool-modal-summary is-bulk">
              <div className="ss-pool-modal-company">Bulk claim</div>
              <div className="ss-pool-badge-row">
                <span className="ss-pool-stat is-accent">
                  <em>Selected</em>
                  {claimIds.length} deals
                </span>
                <span className="ss-pool-stat is-warn">
                  <em>Quota</em>
                  Counts as {claimIds.length} toward your 2/day
                </span>
              </div>
            </div>
          ) : null}

          <div className="ss-pool-step">
            <div className="ss-pool-step-head">
              <span className="ss-pool-step-num">1</span>
              <label className="ss-pool-field-lbl" htmlFor="ss-pool-claim-reason">
                Why are you claiming?{mode === 'bulk' ? ' (shared for all)' : ''}
              </label>
              <span className={`ss-pool-req ${reasonOk ? 'is-ok' : ''}`}>
                {reasonOk ? 'Ready' : 'Required'}
              </span>
            </div>
            <textarea
              id="ss-pool-claim-reason"
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="e.g. Worked this carrier before · nearby territory · following up on prior contact…"
              className={`ss-in ss-pool-reason${reasonOk ? ' is-ok' : ''}`}
            />
          </div>

          <label className={`ss-pool-confirm${confirm ? ' is-on' : ''}`}>
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onConfirm(e.target.checked)}
            />
            <span className="ss-pool-confirm-body">
              <span className="ss-pool-step-head" style={s('margin-bottom:4px')}>
                <span className="ss-pool-step-num">2</span>
                <span className="ss-pool-confirm-title">Confirm assignment</span>
              </span>
              <span className="ss-pool-confirm-text">
                Moves to your Kanban <strong className="ss-pool-accent">New</strong> immediately.
                Counts toward cycle <strong>3</strong> and your <strong>2 claims/day</strong>.
              </span>
            </span>
          </label>
        </div>

        {submitting ? (
          <div className="ss-ret-modal-saving" role="status" aria-live="polite">
            Claiming…
          </div>
        ) : null}

        <div className="ss-pool-modal-foot">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="ss-pool-btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmit}
            className={canSubmit ? 'ss-btn-p ss-pool-btn-primary' : 'ss-pool-btn-disabled'}
            title={
              !reasonOk
                ? 'Add a reason first'
                : !confirm
                  ? 'Confirm assignment first'
                  : undefined
            }
          >
            {submitting ? 'Claiming…' : mode === 'bulk' ? `Claim ${claimIds.length}` : 'Claim deal'}
          </button>
        </div>
      </div>
    </div>
  );
}
