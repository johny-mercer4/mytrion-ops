/**
 * CS Retention Cases — Phase 2 desk (filters, claim, outcomes, attempts).
 */
import { useEffect, useMemo, useState } from 'react';
import type { RetentionCaseRow, RetentionChannel } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { Toast, type ToastState } from '../Toast';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';

type Filter = 'new' | 'working' | 'closed' | 'all_open';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all_open', label: 'Open' },
  { id: 'new', label: 'New' },
  { id: 'working', label: 'Working' },
  { id: 'closed', label: 'Closed' },
];

const CHANNELS: RetentionChannel[] = [
  'ringcentral',
  'telegram',
  'whatsapp',
  'sms',
  'email',
  'instagram',
  'facebook',
];

const OUTCOMES: Array<{
  id: 'saved' | 'refused' | 'out_of_business' | 'no_response' | 'escalate_citi';
  label: string;
  danger?: boolean;
}> = [
  { id: 'saved', label: 'Saved' },
  { id: 'refused', label: 'Refused' },
  { id: 'out_of_business', label: 'Out of business' },
  { id: 'no_response', label: 'No response → Pool' },
  { id: 'escalate_citi', label: 'Escalate CITI', danger: true },
];

function toastMsg(kind: ToastState['kind'], message: string): ToastState {
  return { id: Date.now(), kind, message };
}

function deadlineLabel(c: RetentionCaseRow): string {
  if (!c.currentDeadlineAt) return '—';
  return new Date(c.currentDeadlineAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function CasesPanel() {
  const [filter, setFilter] = useState<Filter>('all_open');
  const feed = useLoad(() => csRetention.cases(filter, 200), [filter]);
  const [rows, setRows] = useState<RetentionCaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [channel, setChannel] = useState<RetentionChannel>('ringcentral');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (feed.data?.cases) setRows(feed.data.cases);
  }, [feed.data?.cases]);

  const reload = feed.reload;
  useEffect(() => {
    return subscribeCsRetentionLive(() => {
      reload();
    });
  }, [reload]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setToast(toastMsg('success', ok));
      setNotes('');
      feed.reload();
    } catch (e) {
      setToast(toastMsg('error', e instanceof Error ? e.message : 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-panel">
      <div className="cs-panel-header">
        <div>
          <h2 className="cs-panel-title">Retention Cases</h2>
          <p className="cs-panel-sub">Phase 2 desk — handed off from Sales · 10 BD watch</p>
        </div>
        <button type="button" className="cs-btn cs-btn-ghost" onClick={() => feed.reload()}>
          Refresh
        </button>
      </div>

      <div className="cs-ret-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`cs-chip${filter === f.id ? ' active' : ''}`}
            onClick={() => {
              setFilter(f.id);
              setSelectedId(null);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {feed.error ? <div className="cs-banner-danger">{feed.error}</div> : null}

      <div className="cs-ret-split">
        <div className="cs-ret-list">
          {feed.loading && rows.length === 0 ? (
            <div className="cs-empty">Loading cases…</div>
          ) : rows.length === 0 ? (
            <div className="cs-empty">No cases in this filter</div>
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
                  <span className="cs-muted">{c.statusCode.replace(/^p2_/, '')}</span>
                </div>
                <div className="cs-ret-row-meta">
                  <span>{c.assignedAgentZohoUserId ? `Agent ${c.assignedAgentZohoUserId}` : 'Unassigned'}</span>
                  <span>Due {deadlineLabel(c)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="cs-ret-detail">
          {!selected ? (
            <div className="cs-empty">Select a case</div>
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
                  <dd>{selected.statusCode}</dd>
                </div>
                <div>
                  <dt>Quiet days</dt>
                  <dd>{selected.daysInactive ?? '—'}</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{deadlineLabel(selected)}</dd>
                </div>
                <div>
                  <dt>Assignments</dt>
                  <dd>{selected.assignmentCount}/3</dd>
                </div>
              </dl>

              {!selected.assignedAgentZohoUserId && !selected.closedAt ? (
                <button
                  type="button"
                  className="cs-btn cs-btn-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => csRetention.caseOutcome(selected.id, 'claim'),
                      'Case claimed — you are working it',
                    )
                  }
                >
                  Claim case
                </button>
              ) : null}

              {!selected.closedAt ? (
                <>
                  <div className="cs-ret-attempt">
                    <label>
                      Channel
                      <select
                        value={channel}
                        onChange={(e) => setChannel(e.target.value as RetentionChannel)}
                      >
                        {CHANNELS.map((ch) => (
                          <option key={ch} value={ch}>
                            {ch}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Notes
                      <input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional note"
                      />
                    </label>
                    <button
                      type="button"
                      className="cs-btn cs-btn-ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => csRetention.logAttempt(selected.id, channel, notes || undefined),
                          'Attempt logged',
                        )
                      }
                    >
                      Log attempt
                    </button>
                  </div>

                  <div className="cs-ret-outcomes">
                    {OUTCOMES.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={`cs-btn ${o.danger ? 'cs-btn-danger' : 'cs-btn-ghost'}`}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => csRetention.caseOutcome(selected.id, o.id),
                            `${o.label} recorded`,
                          )
                        }
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
