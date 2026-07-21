/**
 * CS Open Pool Claims — approve / reject Sales claim requests.
 * Reject deletes the claim_request row and returns the case to the pool.
 */
import { useEffect, useMemo, useState } from 'react';
import type { RetentionPendingClaimRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { Toast, type ToastState } from '../Toast';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';

function toastMsg(kind: ToastState['kind'], message: string): ToastState {
  return { id: Date.now(), kind, message };
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function slaLabel(c: RetentionPendingClaimRow): string {
  if (!c.currentDeadlineAt) return '1 BD';
  const ms = new Date(c.currentDeadlineAt).getTime() - Date.now();
  if (ms <= 0) return 'Overdue';
  const h = Math.ceil(ms / 3_600_000);
  return h <= 24 ? `${h}h left` : `${Math.ceil(h / 24)}d left`;
}

export function ClaimsPanel({ onBadge }: { onBadge?: (n: number) => void }) {
  const feed = useLoad(() => csRetention.claimsPending(100), []);
  const [rows, setRows] = useState<RetentionPendingClaimRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (feed.data?.cases) setRows(feed.data.cases);
  }, [feed.data?.cases]);

  useEffect(() => {
    onBadge?.(rows.length);
  }, [rows.length, onBadge]);

  const reload = feed.reload;
  useEffect(() => {
    return subscribeCsRetentionLive((p) => {
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
      if (kind === 'approve') await csRetention.approveClaim(selected.id);
      else await csRetention.declineClaim(selected.id);
      setToast(
        toastMsg(
          'success',
          kind === 'approve'
            ? 'Claim approved — Zoho ownership transferred · case → New'
            : 'Claim rejected — request deleted · back to Open Pool',
        ),
      );
      setSelectedId(null);
      feed.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      const hint =
        /no Zoho Deal|RETENTION_NO_DEAL|deal id/i.test(msg)
          ? ' Case needs a Zoho Deal id from retention sync before approve.'
          : /Owner|ZOHO_OWNER|Zoho/i.test(msg)
            ? ' Zoho ownership update failed — retry or check CRM permissions.'
            : '';
      setToast(toastMsg('error', `${msg}${hint}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-panel">
      <div className="cs-panel-header">
        <div>
          <h2 className="cs-panel-title">Open Pool Claims</h2>
          <p className="cs-panel-sub">
            Sales request · you approve · Zoho Deal / Contact / Account Owner → claimant · case New
          </p>
        </div>
        <button type="button" className="cs-btn cs-btn-ghost" onClick={() => feed.reload()}>
          Refresh
        </button>
      </div>

      {feed.error ? <div className="cs-banner-danger">{feed.error}</div> : null}

      <div className="cs-ret-split">
        <div className="cs-ret-list">
          {feed.loading && rows.length === 0 ? (
            <div className="cs-empty">Loading claims…</div>
          ) : rows.length === 0 ? (
            <div className="cs-empty">No pending claims</div>
          ) : (
            rows.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`cs-ret-row${selectedId === c.id ? ' active' : ''}`}
                onClick={() => setSelectedId(c.id)}
              >
                <div className="cs-ret-row-main">
                  <strong>{c.companyName || c.carrierId}</strong>
                  <span className="cs-muted">{c.carrierId}</span>
                </div>
                <div className="cs-ret-row-meta">
                  <span>{c.claimRequesterName || c.pendingClaimantZohoUserId || '—'}</span>
                  <span className={slaLabel(c) === 'Overdue' ? 'cs-danger' : 'cs-warn'}>
                    {slaLabel(c)}
                  </span>
                </div>
                {c.claimReason ? (
                  <div className="cs-muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {c.claimReason.length > 80 ? `${c.claimReason.slice(0, 80)}…` : c.claimReason}
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="cs-ret-detail">
          {!selected ? (
            <div className="cs-empty">Select a claim to review</div>
          ) : (
            <>
              <h3>{selected.companyName || selected.carrierId}</h3>
              <dl className="cs-ret-dl">
                <div>
                  <dt>Carrier</dt>
                  <dd>{selected.carrierId}</dd>
                </div>
                <div>
                  <dt>Requester</dt>
                  <dd>
                    {selected.claimRequesterName || selected.pendingClaimantZohoUserId || '—'}
                  </dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{selected.claimReason || '—'}</dd>
                </div>
                <div>
                  <dt>Days inactive</dt>
                  <dd>{selected.daysInactive ?? '—'}</dd>
                </div>
                <div>
                  <dt>Requested</dt>
                  <dd>{fmtWhen(selected.claimRequestedAt || selected.updatedAt)}</dd>
                </div>
                <div>
                  <dt>SLA</dt>
                  <dd>{slaLabel(selected)} · auto-approve if untouched</dd>
                </div>
                <div>
                  <dt>Assignment cycle</dt>
                  <dd>
                    {selected.assignmentCount}/3 → {selected.assignmentCount + 1}/3 on approve
                  </dd>
                </div>
              </dl>
              <div className="cs-ret-actions">
                <button
                  type="button"
                  className="cs-btn cs-btn-danger"
                  disabled={busy}
                  onClick={() => void act('decline')}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="cs-btn cs-btn-primary"
                  disabled={busy}
                  onClick={() => void act('approve')}
                >
                  {busy ? 'Working…' : 'Approve'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
