/**
 * CS Retention Cases — Phase → status filters; detail with colored desk actions.
 * Claim / outcomes / attempts only in Phase 2 Retention (no channel picker).
 */
import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarClock, Hash, RefreshCw, User } from 'lucide-react';
import type { RetentionCaseEventRow, RetentionCaseRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { Toast, type ToastState } from '../Toast';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';
import { CaseDeskActions } from './CaseDeskActions';
import {
  defaultStatusForPhase,
  explainForFilters,
  PHASE_CHIPS,
  statusChipsForPhase,
  type CsPhase,
  type CsStatusBucket,
} from './caseFilters';
import {
  CaseBadge,
  CaseDetailSkeleton,
  CasesListSkeleton,
  FIELD_ICONS,
  Field,
  MetaIcon,
  deadlineDetail,
  deadlineLabel,
  dueUrgency,
  phaseIcon,
  phaseShort,
  phaseTone,
  statusLabel,
  statusTone,
} from './casesUi';

function toastMsg(kind: ToastState['kind'], message: string): ToastState {
  return { id: Date.now(), kind, message };
}

const phaseLabel = (code: string) =>
  code === 'phase_2_retention'
    ? 'Retention (Phase 2)'
    : code === 'phase_3_citi'
      ? 'CITI Folder'
      : code === 'phase_1_agent'
        ? 'Sales (Phase 1)'
        : code;

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const fmtGal = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString('en-US')} gal`;

const agentLabel = (c: RetentionCaseRow) =>
  c.agentName?.trim() ||
  (c.assignedAgentZohoUserId ? `Agent ${c.assignedAgentZohoUserId}` : 'Unassigned');

const isPhase2Actionable = (c: RetentionCaseRow) =>
  c.phaseCode === 'phase_2_retention' && !c.closedAt;

function dueCaption(c: RetentionCaseRow): string {
  const u = dueUrgency(c);
  if (u === 'none') return 'No due date';
  if (u === 'overdue') return `Overdue · ${deadlineLabel(c)}`;
  return `Due ${deadlineLabel(c)}`;
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

function CaseListRow({
  c,
  active,
  index,
  onSelect,
}: {
  c: RetentionCaseRow;
  active: boolean;
  index: number;
  onSelect: () => void;
}) {
  const due = dueUrgency(c);
  const PhaseIcon = phaseIcon(c.phaseCode);
  return (
    <button
      type="button"
      className={`cs-ret-row${active ? ' active' : ''}${due === 'overdue' ? ' is-overdue' : ''}`}
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
      onClick={onSelect}
    >
      <div className="cs-ret-row-top">
        <strong className="cs-ret-row-title">
          <Building2 size={15} strokeWidth={2.2} aria-hidden />
          {c.companyName || c.carrierId}
        </strong>
        <span className={`cs-ret-due is-${due}`}>
          <CalendarClock size={12} strokeWidth={2.3} aria-hidden />
          {dueCaption(c)}
        </span>
      </div>
      <div className="cs-ret-row-badges">
        <CaseBadge tone={phaseTone(c.phaseCode)} icon={PhaseIcon}>
          {phaseShort(c.phaseCode)}
        </CaseBadge>
        <CaseBadge tone={statusTone(c.statusCode)}>{statusLabel(c.statusCode)}</CaseBadge>
        {c.isSpanishDesk ? <CaseBadge tone="orange">ES</CaseBadge> : null}
        {c.closedAt ? (
          <CaseBadge tone={c.statusCode === 'p1_returned' ? 'success' : 'muted'}>
            {c.statusCode === 'p1_returned' ? 'Closed (Returned)' : 'Closed'}
          </CaseBadge>
        ) : null}
      </div>
      <div className="cs-ret-row-meta">
        <span className="cs-ret-meta-with-ico">
          <MetaIcon icon={User} />
          {agentLabel(c)}
        </span>
        <span className="cs-ret-row-carrier">
          <MetaIcon icon={Hash} />
          {c.carrierId}
        </span>
      </div>
    </button>
  );
}

export function CasesPanel() {
  const [phase, setPhase] = useState<CsPhase>('any');
  const [status, setStatus] = useState<CsStatusBucket>('open');
  const statusChips = useMemo(() => statusChipsForPhase(phase), [phase]);
  const filterExplain = useMemo(() => explainForFilters(phase, status), [phase, status]);
  const feed = useLoad(() => csRetention.cases({ phase, status, limit: 200 }), [phase, status]);
  const quota = useLoad(() => csRetention.deskQuota(), []);
  const [rows, setRows] = useState<RetentionCaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    case: RetentionCaseRow;
    events: RetentionCaseEventRow[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (feed.data?.cases) setRows(feed.data.cases);
  }, [feed.data?.cases]);

  const reload = feed.reload;
  const reloadQuota = quota.reload;
  useEffect(() => subscribeCsRetentionLive(() => {
    reload();
    reloadQuota();
  }), [reload, reloadQuota]);

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
  const canAct = selected ? isPhase2Actionable(selected) : false;
  const refreshing = feed.refreshing || feed.loading;

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setToast(toastMsg('success', ok));
      setNotes('');
      feed.reload();
      quota.reload();
      if (selectedId) setDetail(await csRetention.caseGet(selectedId));
    } catch (e) {
      setToast(toastMsg('error', e instanceof Error ? e.message : 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-panel cs-ret-cases">
      <div className="cs-panel-header">
        <div>
          <h2 className="cs-panel-title">Retention Cases</h2>
          <p className="cs-panel-sub">
            Your assigned desk · browse by phase · set outcomes when working a case. Admins see all
            records.
          </p>
        </div>
        <button
          type="button"
          className={`cs-btn cs-btn-ghost${refreshing ? ' is-spinning' : ''}`}
          disabled={refreshing}
          onClick={() => {
            feed.refresh();
            quota.refresh();
          }}
        >
          <RefreshCw
            size={15}
            strokeWidth={2.2}
            aria-hidden
            className={refreshing ? 'cs-ret-spin' : undefined}
          />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {q ? (
        <div className="cs-ret-quota-bar" aria-label="Your Retention desk limits">
          <div
            className={`cs-ret-quota-card is-${
              q.assignedToday >= q.maxPerDay
                ? 'danger'
                : q.assignedToday >= Math.ceil(q.maxPerDay * 0.75)
                  ? 'warn'
                  : 'ok'
            }`}
            title="How many Retention cases you claimed or were assigned today (UTC). Cap resets at midnight UTC."
          >
            <span className="cs-ret-quota-kicker">Claims today</span>
            <span className="cs-ret-quota-value">
              {q.assignedToday}
              <span className="cs-ret-quota-of"> / {q.maxPerDay}</span>
            </span>
            <span className="cs-ret-quota-hint">
              {q.canClaim
                ? 'New claims / assigns left for today'
                : 'Daily cap reached — try again tomorrow'}
            </span>
          </div>
          <div
            className={`cs-ret-quota-card is-${
              !q.canMarkPending || q.pendingRatio >= q.maxPendingRatio
                ? 'danger'
                : q.pendingRatio >= q.maxPendingRatio * 0.66
                  ? 'warn'
                  : 'ok'
            }`}
            title="Offer-out share of your open Retention cases. Cap ~15% of open (at least 1 when you have open work)."
          >
            <span className="cs-ret-quota-kicker">Offer out</span>
            <span className="cs-ret-quota-value">
              {Math.round(q.pendingRatio * 100)}%
              <span className="cs-ret-quota-of">
                {' '}
                of open · cap ~{Math.round(q.maxPendingRatio * 100)}%
              </span>
            </span>
            <span className="cs-ret-quota-hint">
              {q.pending} offer out · {q.open} open
              {q.open === 0
                ? ' — claim a case first'
                : q.canMarkPending
                  ? ''
                  : ' — at cap, clear offers before marking more'}
            </span>
          </div>
        </div>
      ) : (
        <div className="cs-ret-quota-bar" aria-hidden="true">
          <span className="cs-ret-skel-pill" />
          <span className="cs-ret-skel-pill" />
        </div>
      )}

      <div className="cs-ret-filter-stack">
        <div className="cs-ret-filter-row">
          <span className="cs-ret-filter-lbl">Phase</span>
          <div className="cs-ret-filters" role="tablist" aria-label="Phase">
            {PHASE_CHIPS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                title={f.hint}
                aria-selected={phase === f.id}
                className={`cs-chip is-${f.tone}${phase === f.id ? ' active' : ''}`}
                onClick={() => {
                  setPhase(f.id);
                  setStatus(defaultStatusForPhase(f.id));
                  setSelectedId(null);
                }}
              >
                <f.Icon size={14} strokeWidth={2.3} aria-hidden />
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="cs-ret-filter-row">
          <span className="cs-ret-filter-lbl">Status</span>
          <div className="cs-ret-filters" role="tablist" aria-label="Status">
            {statusChips.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                title={f.hint}
                aria-selected={status === f.id}
                className={`cs-chip is-${f.tone}${status === f.id ? ' active' : ''}`}
                onClick={() => {
                  setStatus(f.id);
                  setSelectedId(null);
                }}
              >
                <f.Icon size={14} strokeWidth={2.3} aria-hidden />
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {filterExplain ? (
          <p className="cs-ret-filter-explain" role="status">
            {filterExplain}
          </p>
        ) : null}
      </div>

      {feed.error ? <div className="cs-banner-danger">{feed.error}</div> : null}

      <div className="cs-ret-split">
        <div className="cs-ret-list">
          {feed.loading && rows.length === 0 ? (
            <CasesListSkeleton />
          ) : rows.length === 0 ? (
            <div className="cs-empty cs-ret-empty">
              <div className="cs-ret-empty-title">No cases here</div>
              <div className="cs-ret-empty-body">Try another phase or status filter.</div>
            </div>
          ) : (
            rows.map((c, i) => (
              <CaseListRow
                key={c.id}
                c={c}
                index={i}
                active={selectedId === c.id}
                onSelect={() => setSelectedId(c.id)}
              />
            ))
          )}
        </div>

        <div className="cs-ret-detail">
          {!selected ? (
            <div className="cs-empty cs-ret-empty">
              <div className="cs-ret-empty-title">Select a case</div>
              <div className="cs-ret-empty-body">
                Full detail for any phase. Status actions unlock in Retention.
              </div>
            </div>
          ) : detailLoading && (!detail || detail.case.id !== selectedId) ? (
            <CaseDetailSkeleton />
          ) : (
            <div key={selected.id} className="cs-ret-detail-body">
              <div className="cs-ret-detail-head">
                <h3>
                  <Building2 size={22} strokeWidth={2.1} aria-hidden />
                  {selected.companyName || selected.carrierId}
                </h3>
                <div className="cs-ret-row-badges">
                  <CaseBadge tone={phaseTone(selected.phaseCode)} icon={phaseIcon(selected.phaseCode)}>
                    {phaseShort(selected.phaseCode)}
                  </CaseBadge>
                  <CaseBadge tone={statusTone(selected.statusCode)}>
                    {statusLabel(selected.statusCode)}
                  </CaseBadge>
                  {selected.isSpanishDesk ? <CaseBadge tone="orange">Spanish desk</CaseBadge> : null}
                  {selected.closedAt ? (
                    <CaseBadge tone={selected.statusCode === 'p1_returned' ? 'success' : 'muted'}>
                      {selected.statusCode === 'p1_returned' ? 'Closed (Returned)' : 'Closed'}
                    </CaseBadge>
                  ) : null}
                </div>
              </div>

              {!canAct ? (
                <div className="cs-banner-info">
                  {selected.closedAt
                    ? 'Closed — view only.'
                    : selected.phaseCode === 'phase_1_agent'
                      ? 'Sales phase — view only. Ownership stays with the Sales agent until Retention handoff.'
                      : selected.phaseCode === 'phase_3_citi'
                        ? 'CITI Folder — manage exports from the CITI panel. View only here.'
                        : 'View only for this phase.'}
                </div>
              ) : null}

              <div className="cs-ret-section-lbl">Overview</div>
              <dl className="cs-ret-dl">
                <Field label="Carrier" icon={FIELD_ICONS.carrier}>{selected.carrierId}</Field>
                <Field label="Phase" icon={FIELD_ICONS.phase}>{phaseLabel(selected.phaseCode)}</Field>
                <Field label="Status" icon={FIELD_ICONS.status}>{statusLabel(selected.statusCode)}</Field>
                <Field label="Assignee" icon={FIELD_ICONS.assignee}>{agentLabel(selected)}</Field>
                <Field label="Language" icon={FIELD_ICONS.language}>
                  {selected.preferredLanguage ?? (selected.isSpanishDesk ? 'Spanish' : '—')}
                </Field>
                <Field label="Frequency" icon={FIELD_ICONS.frequency}>
                  {selected.transactionFrequency ?? '—'}
                </Field>
                <Field label="Quiet days" icon={FIELD_ICONS.quiet}>
                  {selected.daysInactive ?? '—'}
                  {selected.thresholdDays != null ? ` / ${selected.thresholdDays}d expect` : ''}
                </Field>
                <Field label="Last fuel" icon={FIELD_ICONS.lastFuel}>
                  {selected.lastTransactionAt
                    ? new Date(selected.lastTransactionAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—'}
                </Field>
                <Field label="90d volume" icon={FIELD_ICONS.volume}>
                  {fmtGal(selected.gallons90d)}
                  {selected.txCount90d != null ? ` · ${selected.txCount90d} tx` : ''}
                </Field>
                <Field label="Active cards" icon={FIELD_ICONS.cards}>
                  {selected.activeCards ?? '—'}
                </Field>
                <Field
                  label="Deadline"
                  icon={FIELD_ICONS.deadline}
                  valueClassName={`cs-ret-due is-${dueUrgency(selected)}`}
                >
                  {deadlineDetail(selected)}
                </Field>
                <Field label="Owners" icon={FIELD_ICONS.pool}>
                  {selected.assignmentCount}/3
                  <span className="cs-ret-field-hint"> · at 3 → CITI</span>
                </Field>
                <Field label="Zoho Deal" icon={FIELD_ICONS.deal} valueClassName="cs-ret-mono">
                  {selected.zohoDealId || '—'}
                </Field>
                <Field label="Two-call" icon={FIELD_ICONS.twoCall}>
                  <span className={`cs-ret-tick${twoCall.listen ? ' on' : ''}`}>
                    Call 1 {twoCall.listen ? '✓' : '—'}
                  </span>
                  {' · '}
                  <span className={`cs-ret-tick${twoCall.solution ? ' on' : ''}`}>
                    Call 2 {twoCall.solution ? '✓' : '—'}
                  </span>
                </Field>
              </dl>

              {canAct ? (
                <>
                  <div className="cs-ret-section-lbl">Update case</div>
                  <CaseDeskActions
                    busy={busy}
                    canClaim={canClaim}
                    canMarkPending={canMarkPending}
                    unassigned={!selected.assignedAgentZohoUserId}
                    twoCall={twoCall}
                    notes={notes}
                    onNotes={setNotes}
                    onClaim={() =>
                      void run(
                        () => csRetention.caseOutcome(selected.id, 'claim'),
                        'Case claimed — you are working it',
                      )
                    }
                    onLogListen={() =>
                      void run(
                        () =>
                          csRetention.logAttempt(
                            selected.id,
                            'ringcentral',
                            notes || undefined,
                            'listen',
                          ),
                        'Call 1 (listen) logged',
                      )
                    }
                    onLogSolution={() =>
                      void run(
                        () =>
                          csRetention.logAttempt(
                            selected.id,
                            'ringcentral',
                            notes || undefined,
                            'solution',
                          ),
                        'Call 2 (solution) logged',
                      )
                    }
                    onOutcome={(id) =>
                      void run(
                        () =>
                          csRetention.caseOutcome(
                            selected.id,
                            id,
                            notes.trim() || undefined,
                          ),
                        id === 'mark_pending'
                          ? 'Offer out recorded'
                          : id === 'escalate_citi'
                            ? 'Escalated to CITI Folder'
                            : id === 'out_of_business'
                              ? 'Closed — out of business'
                              : id === 'refused'
                                ? 'Closed — refused'
                                : 'Status updated',
                      )
                    }
                  />
                </>
              ) : null}

              <div className="cs-ret-timeline-wrap">
                <h4>Timeline</h4>
                {detail?.events?.length ? (
                  <ul className="cs-ret-timeline">
                    {detail.events.map((ev, i) => (
                      <li key={ev.id} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                        <div className="cs-ret-timeline-title">
                          {ev.eventType}
                          {ev.toStatus ? ` → ${statusLabel(ev.toStatus)}` : ''}
                        </div>
                        <div className="cs-muted">{fmtWhen(ev.occurredAt)}</div>
                        {ev.notes ? <div className="cs-ret-timeline-notes">{ev.notes}</div> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="cs-muted" style={{ fontSize: 12 }}>
                    No events yet
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
