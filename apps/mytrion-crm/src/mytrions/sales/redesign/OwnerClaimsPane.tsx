/**
 * Sales Open Pool Claims — prior owner approve / decline queue.
 * Approve transfers Zoho Deal/Contact/Company to the claiming Sales agent.
 */
import { useEffect, useMemo, useState } from 'react';
import type { RetentionPendingClaimRow } from '@/api/touchpointTypes';
import { useLoad } from '../../_shared/useLoad';
import { s } from './dc';
import { Icon } from './icons';
import { fmtGal } from './RetentionBoardUi';
import {
  approveOwnerPoolClaim,
  declineOwnerPoolClaim,
  loadOwnerPendingClaims,
  quietCaption,
} from './retentionData';
import { subscribeRetentionLive } from './retentionLiveBus';
import { useSales } from './ctx';

function slaLabel(c: RetentionPendingClaimRow): string {
  if (!c.currentDeadlineAt) return '1 BD';
  const ms = new Date(c.currentDeadlineAt).getTime() - Date.now();
  if (ms <= 0) return 'Overdue';
  const h = Math.ceil(ms / 3_600_000);
  return h <= 24 ? `${h}h left` : `${Math.ceil(h / 24)}d left`;
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OwnerClaimsPane({ onPendingCount }: { onPendingCount?: (n: number) => void }) {
  const { pushToast } = useSales();
  const feed = useLoad(() => loadOwnerPendingClaims(100), []);
  const [rows, setRows] = useState<RetentionPendingClaimRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (feed.data?.cases) setRows(feed.data.cases);
  }, [feed.data?.cases]);

  useEffect(() => {
    onPendingCount?.(rows.length);
  }, [rows.length, onPendingCount]);

  const reload = feed.reload;
  useEffect(() => {
    return subscribeRetentionLive((p) => {
      if (
        p.type === 'retention.claim_request' ||
        p.type === 'retention.claim_approved' ||
        p.type === 'retention.claim_declined' ||
        p.type === 'retention.pool.opened'
      ) {
        reload();
      }
    });
  }, [reload]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const act = async (kind: 'approve' | 'decline'): Promise<void> => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      if (kind === 'approve') await approveOwnerPoolClaim(selected.id);
      else await declineOwnerPoolClaim(selected.id);
      pushToast(
        kind === 'approve' ? 'Claim approved' : 'Claim declined',
        kind === 'approve'
          ? 'Deal / Contact / Company transferred · case → New for claimant'
          : 'Back to Open Pool — request deleted',
      );
      setSelectedId(null);
      feed.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      pushToast('Claim action failed', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s('display:flex;flex-direction:column;gap:14px;min-height:0')}>
      <div
        style={s(
          'padding:16px 18px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);display:flex;justify-content:space-between;gap:12px;align-items:flex-start',
        )}
      >
        <div>
          <div
            style={s(
              'font-family:Rajdhani,sans-serif;font-weight:700;font-size:var(--ss-text-xl);letter-spacing:.05em;text-transform:uppercase',
            )}
          >
            Open Pool Claims
          </div>
          <div style={s('font-size:13px;color:var(--muted);margin-top:4px;line-height:1.45;max-width:52ch')}>
            Agents requesting your former deals. Approve transfers Deal / Contact / Company ownership
            (1 BD auto if untouched).
          </div>
        </div>
        <button
          type="button"
          onClick={() => feed.reload()}
          className="ss-ico-btn"
          aria-label="Refresh"
          style={s(
            'width:38px;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center',
          )}
        >
          <Icon
            name="refresh"
            size={16}
            style={s(feed.loading ? 'animation:ss-spin .9s linear infinite' : '')}
          />
        </button>
      </div>

      {feed.error ? (
        <div
          style={s(
            'padding:14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border));background:color-mix(in srgb,var(--danger) 8%,transparent);color:var(--danger);font-size:13px',
          )}
        >
          {feed.error}
        </div>
      ) : null}

      <div
        style={s(
          'display:grid;grid-template-columns:minmax(240px,1fr) minmax(280px,1.1fr);gap:12px;min-height:320px',
        )}
      >
        <div
          className="ss-scroll"
          style={s(
            'border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:auto;max-height:min(60vh,560px)',
          )}
        >
          {feed.loading && rows.length === 0 ? (
            <div style={s('padding:28px;color:var(--muted);font-size:13px')}>Loading claims…</div>
          ) : rows.length === 0 ? (
            <div style={s('padding:28px;color:var(--muted);font-size:13px')}>
              No pending claims on your deals
            </div>
          ) : (
            rows.map((c) => {
              const overdue = slaLabel(c) === 'Overdue';
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  style={s(
                    `display:block;width:100%;text-align:left;padding:12px 14px;border:none;border-bottom:1px solid var(--border2);background:${selectedId === c.id ? 'color-mix(in srgb,var(--accent) 10%,var(--alt))' : 'transparent'};cursor:pointer`,
                  )}
                >
                  <div style={s('display:flex;justify-content:space-between;gap:8px')}>
                    <strong style={s('font-size:13px')}>{c.companyName || c.carrierId}</strong>
                    <span
                      style={s(
                        `font-size:11px;font-weight:700;color:${overdue ? 'var(--danger)' : 'var(--warn)'}`,
                      )}
                    >
                      {slaLabel(c)}
                    </span>
                  </div>
                  <div style={s('font-size:12px;color:var(--muted);margin-top:4px')}>
                    {c.claimRequesterName || c.pendingClaimantZohoUserId || 'Requester'} ·{' '}
                    {quietCaption(c)}
                  </div>
                  {c.claimReason ? (
                    <div style={s('font-size:12px;color:var(--text2);margin-top:6px;line-height:1.4')}>
                      {c.claimReason.length > 90 ? `${c.claimReason.slice(0, 90)}…` : c.claimReason}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div
          style={s(
            'border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);padding:16px 18px',
          )}
        >
          {!selected ? (
            <div style={s('color:var(--muted);font-size:13px;padding:20px 0')}>
              Select a claim to approve or decline
            </div>
          ) : (
            <>
              <h3 style={s('margin:0;font-size:16px;font-weight:700')}>
                {selected.companyName || selected.carrierId}
              </h3>
              <dl
                style={s(
                  'margin:14px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:12px',
                )}
              >
                <div>
                  <dt style={s('color:var(--muted);font-weight:700')}>Carrier</dt>
                  <dd style={s('margin:2px 0 0')}>{selected.carrierId}</dd>
                </div>
                <div>
                  <dt style={s('color:var(--muted);font-weight:700')}>90d gallons</dt>
                  <dd style={s('margin:2px 0 0')}>
                    {selected.gallons90d != null ? fmtGal(selected.gallons90d) : '—'}
                  </dd>
                </div>
                <div style={s('grid-column:1 / -1')}>
                  <dt style={s('color:var(--muted);font-weight:700')}>Requester</dt>
                  <dd style={s('margin:2px 0 0')}>
                    {selected.claimRequesterName || selected.pendingClaimantZohoUserId || '—'}
                  </dd>
                </div>
                <div style={s('grid-column:1 / -1')}>
                  <dt style={s('color:var(--muted);font-weight:700')}>Reason</dt>
                  <dd style={s('margin:2px 0 0;white-space:pre-wrap;line-height:1.45')}>
                    {selected.claimReason || '—'}
                  </dd>
                </div>
                <div>
                  <dt style={s('color:var(--muted);font-weight:700')}>Requested</dt>
                  <dd style={s('margin:2px 0 0')}>
                    {fmtWhen(selected.claimRequestedAt || selected.updatedAt)}
                  </dd>
                </div>
                <div>
                  <dt style={s('color:var(--muted);font-weight:700')}>Assignment</dt>
                  <dd style={s('margin:2px 0 0')}>
                    {selected.assignmentCount}/3 → {selected.assignmentCount + 1}/3 on approve
                  </dd>
                </div>
              </dl>
              <div style={s('display:flex;gap:10px;margin-top:18px')}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('decline')}
                  style={s(
                    `flex:1;height:40px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger);font-weight:700;font-size:13px;cursor:${busy ? 'wait' : 'pointer'}`,
                  )}
                >
                  Decline
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('approve')}
                  className="ss-btn-p"
                  style={s(
                    `flex:1;height:40px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:${busy ? 'wait' : 'pointer'}`,
                  )}
                >
                  {busy ? 'Working…' : 'Approve transfer'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
