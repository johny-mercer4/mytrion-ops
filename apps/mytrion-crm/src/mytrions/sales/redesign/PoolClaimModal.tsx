/**
 * Open Pool claim request modal — reason + confirm before prior-owner approval.
 */
import type { ChangeEvent, MouseEvent } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { fmtGal } from './RetentionBoardUi';
import { quietCaption, type RetentionCaseRow } from './retentionData';

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
            <div id="ss-pool-claim-title" className="ss-pool-modal-title">
              {mode === 'single'
                ? `Request claim · ${singleSummary?.companyName || singleSummary?.carrierId || 'deal'}`
                : `Request claim · ${claimIds.length} deals`}
            </div>
            <div className="ss-pool-modal-sub">
              Reason required · prior owner reviews — auto-approves in 1 BD if no response
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
              <div>
                <strong>{singleSummary.companyName || '—'}</strong>
                {' · '}
                {singleSummary.carrierId}
              </div>
              <div>
                Quiet {quietCaption(singleSummary)} · Cycle {singleSummary.assignmentCount}/3 ·{' '}
                {singleSummary.gallons90d != null ? `${fmtGal(singleSummary.gallons90d)} gal` : '—'}
              </div>
            </div>
          ) : null}

          <div>
            <label className="ss-pool-field-lbl" htmlFor="ss-pool-claim-reason">
              Why are you claiming?{mode === 'bulk' ? ' (shared for all)' : ''}
            </label>
            <textarea
              id="ss-pool-claim-reason"
              value={reason}
              onChange={(e) => onReason(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Brief reason for the prior owner…"
              className="ss-in ss-pool-reason"
            />
          </div>

          <label className="ss-pool-confirm">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onConfirm(e.target.checked)}
            />
            <span>
              I understand: after prior-owner approval this lands in my Kanban{' '}
              <strong className="ss-pool-accent">New</strong> under my ownership and counts
              toward the 3-agent Open Pool limit.
            </span>
          </label>
        </div>

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
          >
            {submitting ? 'Requesting…' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  );
}
