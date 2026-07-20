/**
 * Incoming Open Pool claim requests — deal owner approves or declines (1 BD auto).
 */
import { useEffect, useState } from 'react';
import { useLoad } from '../../_shared/useLoad';
import { useSales } from './ctx';
import { s } from './dc';
import { Icon } from './icons';
import {
  approvePoolClaim,
  declinePoolClaim,
  deadlineCaption,
  loadPendingPoolClaims,
  quietCaption,
  type RetentionCaseRow,
} from './retentionData';
import { subscribeRetentionLive } from './retentionLiveBus';

export function PoolClaimsPane() {
  const { pushToast } = useSales();
  const feed = useLoad(() => loadPendingPoolClaims(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const cases = feed.data?.cases ?? [];

  useEffect(
    () =>
      subscribeRetentionLive((payload) => {
        if (
          payload.type === 'retention.claim_request' ||
          payload.type === 'retention.claim_approved' ||
          payload.type === 'retention.claim_declined' ||
          payload.type === 'retention.pool.opened'
        ) {
          feed.reload();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const act = async (id: string, kind: 'approve' | 'decline'): Promise<void> => {
    if (busyId) return;
    setBusyId(id);
    try {
      if (kind === 'approve') {
        await approvePoolClaim(id);
        pushToast('Claim approved', 'Deal transferred — claimant has 3 BD');
      } else {
        await declinePoolClaim(id);
        pushToast('Claim declined', 'Deal stays in Open Pool');
      }
      feed.reload();
    } catch (e) {
      pushToast('Action failed', e instanceof Error ? e.message : 'Could not update claim');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={s('display:flex;flex-direction:column;gap:14px;min-height:0')}>
      <div>
        <div
          style={s(
            'font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase',
          )}
        >
          Claim requests
        </div>
        <div style={s('font-size:13px;color:var(--muted);margin-top:2px')}>
          Other agents requesting your Open Pool deals. Approve, decline, or wait — auto-approves
          in 1 BD.
        </div>
      </div>

      {feed.error && (
        <div style={s('color:var(--danger);font-size:13px')}>{feed.error}</div>
      )}

      {feed.loading && cases.length === 0 && (
        <div className="ss-skel" style={s('height:120px;border-radius:var(--radius-md)')} />
      )}

      {!feed.loading && cases.length === 0 && (
        <div
          style={s(
            'padding:36px 20px;text-align:center;border-radius:var(--radius-md);border:1px dashed var(--border);background:var(--alt);font-size:13px;color:var(--muted)',
          )}
        >
          No pending claim requests.
        </div>
      )}

      <div style={s('display:flex;flex-direction:column;gap:10px')}>
        {cases.map((c) => (
          <ClaimCard
            key={c.id}
            row={c}
            busy={busyId === c.id}
            onApprove={() => void act(c.id, 'approve')}
            onDecline={() => void act(c.id, 'decline')}
          />
        ))}
      </div>
    </div>
  );
}

function ClaimCard({
  row,
  busy,
  onApprove,
  onDecline,
}: {
  row: RetentionCaseRow;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      style={s(
        'padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between',
      )}
    >
      <div style={s('min-width:0;flex:1')}>
        <div style={s('font-weight:700;font-size:14px')}>{row.companyName || '—'}</div>
        <div style={s("font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)")}>
          {row.carrierId}
          {row.pendingClaimantZohoUserId
            ? ` · claimant ${row.pendingClaimantZohoUserId}`
            : ''}
        </div>
        <div style={s('font-size:12px;color:var(--warn);margin-top:4px')}>
          {quietCaption(row)} · {deadlineCaption(row)}
        </div>
      </div>
      <div style={s('display:flex;gap:8px')}>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          style={s(
            'height:34px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-weight:700;font-size:12px;cursor:pointer',
          )}
        >
          Decline
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="ss-btn-p"
          style={s(
            'height:34px;padding:0 12px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px',
          )}
        >
          {busy ? (
            <span
              style={s(
                'width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:ss-spin .8s linear infinite',
              )}
            />
          ) : (
            <Icon name="assign" size={13} />
          )}
          Approve
        </button>
      </div>
    </div>
  );
}
