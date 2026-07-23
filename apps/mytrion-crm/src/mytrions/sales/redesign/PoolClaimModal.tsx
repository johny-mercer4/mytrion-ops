/**
 * Open Pool claim modal — reason + confirm; assigns instantly (Zoho + Kanban New).
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
                ? `Claim · ${singleSummary?.companyName || singleSummary?.carrierId || 'deal'}`
                : `Claim · ${claimIds.length} deals`}
            </div>
            <div className="ss-pool-modal-sub">
              Reason required · instant assign · max 2/day
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
              placeholder="Brief reason for the claim…"
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
              Assigns to my Kanban <strong className="ss-pool-accent">New</strong> now · counts
              toward cycle 3 and my 2 claims/day.
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
          >
            {submitting ? 'Claiming…' : 'Claim'}
          </button>
        </div>
      </div>
    </div>
  );
}
