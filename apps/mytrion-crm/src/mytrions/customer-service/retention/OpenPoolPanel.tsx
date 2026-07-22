/**
 * CS Open Pool — read-only visibility of Sales Open Pool deals.
 * CS cannot claim or approve; ownership stays with Sales until prior owner approves.
 */
import { useEffect, useMemo, useState } from 'react';
import type { RetentionCaseRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';
import { statusLabel } from './casesUi';

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function poolStatus(c: RetentionCaseRow): string {
  if (c.statusCode === 'p1_pool_claim_pending') return 'Claim pending';
  if (c.statusCode === 'p1_open_pool') return 'Available';
  return statusLabel(c.statusCode);
}

export function OpenPoolPanel() {
  const feed = useLoad(() => csRetention.poolList(200), []);
  const [rows, setRows] = useState<RetentionCaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (feed.data?.cases) setRows(feed.data.cases);
  }, [feed.data?.cases]);

  const reload = feed.reload;
  useEffect(() => {
    return subscribeCsRetentionLive((p) => {
      if (
        p.type === 'retention.pool.opened' ||
        p.type === 'retention.claim_request' ||
        p.type === 'retention.claim_approved' ||
        p.type === 'retention.claim_declined'
      ) {
        reload();
      }
    });
  }, [reload]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const available = rows.filter((c) => c.statusCode === 'p1_open_pool').length;
  const pending = rows.filter((c) => c.statusCode === 'p1_pool_claim_pending').length;

  return (
    <div className="cs-panel">
      <div className="cs-panel-header">
        <div>
          <h2 className="cs-panel-title">Open Pool</h2>
          <p className="cs-panel-sub">
            Read-only · {available} available · {pending} claim pending · Sales prior owner approves
            ownership transfers
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
            <div className="cs-empty">Loading Open Pool…</div>
          ) : rows.length === 0 ? (
            <div className="cs-empty">Open Pool is empty</div>
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
                  <span>{poolStatus(c)}</span>
                  <span className="cs-muted">{c.daysInactive ?? '—'}d quiet</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="cs-ret-detail">
          {!selected ? (
            <div className="cs-empty">Select a deal to inspect</div>
          ) : (
            <>
              <h3>{selected.companyName || selected.carrierId}</h3>
              <dl className="cs-ret-dl">
                <div>
                  <dt>Carrier</dt>
                  <dd>{selected.carrierId}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{poolStatus(selected)}</dd>
                </div>
                <div>
                  <dt>Prior Sales owner</dt>
                  <dd>{selected.poolOwnerZohoUserId || '—'}</dd>
                </div>
                <div>
                  <dt>Pending claimant</dt>
                  <dd>{selected.pendingClaimantZohoUserId || '—'}</dd>
                </div>
                <div>
                  <dt>Days inactive</dt>
                  <dd>{selected.daysInactive ?? '—'}</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{fmtWhen(selected.currentDeadlineAt)}</dd>
                </div>
                <div>
                  <dt>Assignment cycle</dt>
                  <dd>{selected.assignmentCount}/3</dd>
                </div>
              </dl>
              <p className="cs-muted" style={{ marginTop: 16, fontSize: 13, lineHeight: 1.45 }}>
                View only — CS cannot claim Open Pool deals or approve ownership transfers. Deal /
                Contact / Company stay with the Sales agent until they approve a claim.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
