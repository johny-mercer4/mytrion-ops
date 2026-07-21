/**
 * CS Retention Cases — Phase 2 desk (filters, claim, outcomes, attempts, timeline).
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  RetentionCaseEventRow,
  RetentionCaseRow,
  RetentionChannel,
} from '@/api/touchpointTypes';
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
  id: 'mark_pending' | 'saved' | 'refused' | 'out_of_business' | 'no_response' | 'escalate_citi';
  label: string;
  danger?: boolean;
  needsTwoCall?: boolean;
  needsPendingCap?: boolean;
}> = [
  { id: 'mark_pending', label: 'Mark pending', needsPendingCap: true },
  { id: 'saved', label: 'Saved', needsTwoCall: true },
  { id: 'refused', label: 'Refused', needsTwoCall: true },
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

function phaseLabel(code: string): string {
  if (code === 'phase_2_retention') return 'Retention (Phase 2)';
  if (code === 'phase_3_citi') return 'CITI Folder';
  if (code === 'phase_1_agent') return 'Sales (Phase 1)';
  return code;
}

function statusLabel(code: string): string {
  const map: Record<string, string> = {
    p2_new: 'New',
    p2_working: 'Working',
    p2_offer_pending: 'Offer pending',
    p2_saved: 'Saved',
    p2_refused: 'Refused',
    p2_out_of_business: 'Out of business',
    p2_handoff_citi: 'Handoff CITI',
  };
  return map[code] ?? code.replace(/^p2_/, '').replace(/_/g, ' ');
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function agentLabel(c: RetentionCaseRow): string {
  if (c.agentName?.trim()) return c.agentName.trim();
  if (c.assignedAgentZohoUserId) return `Agent ${c.assignedAgentZohoUserId}`;
  return 'Unassigned';
}

function twoCallFromEvents(events: RetentionCaseEventRow[] | undefined): {
  listen: boolean;
  solution: boolean;
} {
  let listen = false;
  let solution = false;
  for (const ev of events ?? []) {
    if (ev.eventType !== 'comms_attempt' || !ev.notes) continue;
    if (/\[call_role:listen\]/i.test(ev.notes)) listen = true;
    if (/\[call_role:solution\]/i.test(ev.notes)) solution = true;
  }
  return { listen, solution };
}

export function CasesPanel() {
  const [filter, setFilter] = useState<Filter>('all_open');
  const feed = useLoad(() => csRetention.cases(filter, 200), [filter]);
  const quota = useLoad(() => csRetention.deskQuota(), []);
  const [rows, setRows] = useState<RetentionCaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    case: RetentionCaseRow;
    events: RetentionCaseEventRow[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [channel, setChannel] = useState<RetentionChannel>('ringcentral');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (feed.data?.cases) setRows(feed.data.cases);
  }, [feed.data?.cases]);

  const reload = feed.reload;
  const reloadQuota = quota.reload;
  useEffect(() => {
    return subscribeCsRetentionLive(() => {
      reload();
      reloadQuota();
    });
  }, [reload, reloadQuota]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void csRetention
      .caseGet(selectedId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          setToast(toastMsg('error', e instanceof Error ? e.message : 'Failed to load case'));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, feed.data?.cases]);

  const selected = useMemo(() => {
    if (detail?.case && detail.case.id === selectedId) return detail.case;
    return rows.find((r) => r.id === selectedId) ?? null;
  }, [detail, rows, selectedId]);

  const twoCall = useMemo(() => twoCallFromEvents(detail?.events), [detail?.events]);
  const q = quota.data;
  const canClaim = q?.canClaim !== false;
  const canMarkPending = q?.canMarkPending !== false;

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setToast(toastMsg('success', ok));
      setNotes('');
      feed.reload();
      quota.reload();
      if (selectedId) {
        const res = await csRetention.caseGet(selectedId);
        setDetail(res);
      }
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
          <p className="cs-panel-sub">
            Phase 2 desk — Spanish desk / RoundRobin · 10 BD · two-call · caps
          </p>
        </div>
        <button
          type="button"
          className="cs-btn cs-btn-ghost"
          onClick={() => {
            feed.reload();
            quota.reload();
          }}
        >
          Refresh
        </button>
      </div>

      {q ? (
        <div className="cs-ret-filters" style={{ marginBottom: 8 }}>
          <span className="cs-chip">
            Today {q.assignedToday}/{q.maxPerDay}
          </span>
          <span className="cs-chip">
            Pending {q.pending}/{q.open || 0} (
            {Math.round(q.pendingRatio * 100)}% / {Math.round(q.maxPendingRatio * 100)}%)
          </span>
        </div>
      ) : null}

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
                  <strong>
                    {c.companyName || c.carrierId}
                    {c.isSpanishDesk ? ' · ES' : ''}
                  </strong>
                  <span className="cs-muted">{statusLabel(c.statusCode)}</span>
                </div>
                <div className="cs-ret-row-meta">
                  <span>{agentLabel(c)}</span>
                  <span>Due {deadlineLabel(c)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="cs-ret-detail">
          {!selected ? (
            <div className="cs-empty">Select a case</div>
          ) : detailLoading && !detail ? (
            <div className="cs-empty">Loading detail…</div>
          ) : (
            <>
              <h3>
                {selected.companyName || selected.carrierId}
                {selected.isSpanishDesk ? (
                  <span className="cs-chip" style={{ marginLeft: 8 }}>
                    Spanish desk
                  </span>
                ) : null}
              </h3>
              <dl className="cs-ret-dl">
                <div>
                  <dt>Carrier</dt>
                  <dd>{selected.carrierId}</dd>
                </div>
                <div>
                  <dt>Phase</dt>
                  <dd>{phaseLabel(selected.phaseCode)}</dd>
                </div>
                <div>
                  <dt>Status / stage</dt>
                  <dd>{statusLabel(selected.statusCode)}</dd>
                </div>
                <div>
                  <dt>Assignee</dt>
                  <dd>{agentLabel(selected)}</dd>
                </div>
                <div>
                  <dt>Language</dt>
                  <dd>{selected.preferredLanguage ?? (selected.isSpanishDesk ? 'Spanish' : '—')}</dd>
                </div>
                <div>
                  <dt>Quiet days</dt>
                  <dd>{selected.daysInactive ?? '—'}</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>
                    {deadlineLabel(selected)}
                    {selected.currentDeadlineType ? ` · ${selected.currentDeadlineType}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Open Pool cycle</dt>
                  <dd>{selected.assignmentCount}/3</dd>
                </div>
                <div>
                  <dt>Two-call</dt>
                  <dd>
                    Call 1 {twoCall.listen ? '✓' : '—'} · Call 2 {twoCall.solution ? '✓' : '—'}
                  </dd>
                </div>
              </dl>

              {!selected.assignedAgentZohoUserId && !selected.closedAt ? (
                <button
                  type="button"
                  className="cs-btn cs-btn-primary"
                  disabled={busy || !canClaim}
                  title={!canClaim ? 'Daily 40-deal cap reached' : undefined}
                  onClick={() =>
                    void run(
                      () => csRetention.caseOutcome(selected.id, 'claim'),
                      'Case claimed — you are working it',
                    )
                  }
                >
                  Claim case{!canClaim ? ' (cap)' : ''}
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
                          () =>
                            csRetention.logAttempt(
                              selected.id,
                              channel,
                              notes || undefined,
                              'listen',
                            ),
                          'Call 1 (listen) logged',
                        )
                      }
                    >
                      Log Call 1 (listen)
                    </button>
                    <button
                      type="button"
                      className="cs-btn cs-btn-ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            csRetention.logAttempt(
                              selected.id,
                              channel,
                              notes || undefined,
                              'solution',
                            ),
                          'Call 2 (solution) logged',
                        )
                      }
                    >
                      Log Call 2 (solution)
                    </button>
                  </div>

                  <div className="cs-ret-outcomes">
                    {OUTCOMES.map((o) => {
                      const blockedTwoCall =
                        o.needsTwoCall && !(twoCall.listen && twoCall.solution);
                      const blockedPending = o.needsPendingCap && !canMarkPending;
                      const disabled = busy || blockedTwoCall || blockedPending;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          className={`cs-btn ${o.danger ? 'cs-btn-danger' : 'cs-btn-ghost'}`}
                          disabled={disabled}
                          title={
                            blockedTwoCall
                              ? 'Log Call 1 + Call 2 first'
                              : blockedPending
                                ? 'Pending portfolio over 15%'
                                : undefined
                          }
                          onClick={() =>
                            void run(
                              () => csRetention.caseOutcome(selected.id, o.id),
                              `${o.label} recorded`,
                            )
                          }
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              <div style={{ marginTop: 16 }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>Timeline</h4>
                {detail?.events?.length ? (
                  <ul className="cs-ret-timeline" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {detail.events.map((ev) => (
                      <li
                        key={ev.id}
                        style={{
                          padding: '8px 0',
                          borderTop: '1px solid var(--border, #e5e7eb)',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {ev.eventType}
                          {ev.toStatus ? ` → ${ev.toStatus}` : ''}
                        </div>
                        <div className="cs-muted">{fmtWhen(ev.occurredAt)}</div>
                        {ev.notes ? <div style={{ marginTop: 2 }}>{ev.notes}</div> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="cs-muted" style={{ fontSize: 12 }}>
                    No events yet
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
