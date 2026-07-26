import { useMemo, useState } from 'react';
import { Check, Inbox, X } from 'lucide-react';
import { HrEmpty, HrPageHead, Pill, PreviewBanner, toneFor } from '../HrBits';
import { PREVIEW_REQUESTS, type HrRequestVM } from '../peoplePreview';

/**
 * HR → Requests. Leave, remote-work and expense requests awaiting a decision.
 *
 * Approve / Reject are rendered but INERT and disabled — the approval path is a write, and writes
 * need an audited, role-gated endpoint behind them (the same rule the backend applies elsewhere:
 * riskClass 'write' + admin role). Showing a live-looking button that silently does nothing is
 * worse than showing a disabled one, so they carry a title explaining why.
 */

type StatusFilter = 'all' | HrRequestVM['status'];

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Pending', label: 'Pending' },
  { id: 'Approved', label: 'Approved' },
  { id: 'Rejected', label: 'Rejected' },
];

export function HrRequests() {
  const [status, setStatus] = useState<StatusFilter>('all');

  const rows = useMemo(
    () => PREVIEW_REQUESTS.filter((r) => status === 'all' || r.status === status),
    [status],
  );
  const pending = PREVIEW_REQUESTS.filter((r) => r.status === 'Pending').length;

  return (
    <div className="hr-page">
      <HrPageHead tab="requests" />
      <PreviewBanner what="Requests" />

      <div className="hr-toolbar">
        <div className="hr-summary">
          <strong>{pending}</strong> pending · <strong>{PREVIEW_REQUESTS.length}</strong> placeholder
          records
        </div>
        <div className="hr-chips">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="hr-chip"
              aria-pressed={status === f.id}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <HrEmpty
          icon={<Inbox size={30} />}
          title="Nothing here"
          body="No requests with this status. Once Zoho People is connected this list will show real submissions."
        />
      ) : (
        <div className="hr-req-list">
          {rows.map((r) => (
            <article key={r.id} className="hr-req">
              <span className="hr-glyph" style={{ width: 36, height: 36 }}>
                <Inbox size={16} />
              </span>
              <div className="hr-req-main">
                <span className="hr-req-title">
                  {r.kind} · {r.employee}
                </span>
                <span className="hr-req-sub">
                  {r.range} · submitted {r.submitted}
                </span>
              </div>
              <Pill label={r.status} tone={toneFor(r.status)} />
              {r.status === 'Pending' ? (
                <div className="hr-head-actions">
                  <button
                    type="button"
                    className="hr-btn"
                    disabled
                    title="Approving is a write action — enabled once the audited HR endpoint exists."
                  >
                    <Check size={14} />
                    Approve
                  </button>
                  <button
                    type="button"
                    className="hr-btn"
                    disabled
                    title="Rejecting is a write action — enabled once the audited HR endpoint exists."
                  >
                    <X size={14} />
                    Reject
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
