/**
 * Team / All attendance directory.
 * Managers: Team = reportees ∪ departments they lead.
 * Admins / HR Manager: Team = direct reports; All = every Active employee.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Search, Users, X } from 'lucide-react';
import {
  assignAttendanceShift,
  getAttendanceSummary,
  getAttendanceTeam,
  listAttendanceShifts,
  type AttendanceSummaryDto,
  type HrAttendanceShiftDto,
  type AttendanceTeamListDto,
  type AttendanceTeamListItem,
  type AttendanceTeamScope,
} from '../../api/hr';
import { formatCachedAt, useCachedLoad } from '../_shared/swrCache';
import { HrBusy, HrEmpty, HrPageLoader } from './HrBits';
import { HrSelect, type HrSelectOption } from './HrSelect';
import { HrAttendanceWeek } from './HrAttendanceWeek';

export interface TeamSummary {
  people: number;
  inOffice: number;
  needsReview: number;
  noShift: number;
}

/** The same wording the tab's tiles and the day rows use, so one state is never named two ways. */
const PRESENCE_TEXT: Record<string, string> = {
  in_office: 'In office',
  out_of_office: 'Out',
  needs_review: 'Needs review',
  no_activity: 'No activity',
};

export function HrAttendanceTeam({
  scope,
  today,
  weekOf,
  orgWide = false,
  refreshToken = 0,
  onSummary,
}: {
  scope: AttendanceTeamScope;
  /**
   * Tashkent "today" owned by the tab, which re-derives it across midnight. Not derived here:
   * without the remount `key` a local value would freeze at mount, and it is load-bearing —
   * HrAttendanceWeek decides live-presence vs. historical week summary from `today ∈ days`.
   */
  today: string;
  weekOf: string;
  /** True when the All tab is active (org-wide directory). */
  orgWide?: boolean;
  /**
   * Bumped by the tab's Refresh button to refetch the roster and the shift list.
   *
   * A prop rather than a remount `key`: remounting threw away the open person, the search text and
   * the scroll position, so Refresh — which means "same view, newer numbers" — silently undid the
   * user's navigation.
   */
  refreshToken?: number;
  /**
   * Roster counts, reported up so the TAB can show them in its summary row — the same shape as the org
   * canvas's `onHiddenCount`. The tiles belong above the pane switcher with every other HR tab's, and
   * only this component knows the roster.
   */
  onSummary?: ((summary: TeamSummary) => void) | undefined;
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The row as it was picked, so a search that filters the person out still names them. */
  const [selectedEmp, setSelectedEmp] = useState<AttendanceTeamListItem | null>(null);
  const [detail, setDetail] = useState<AttendanceSummaryDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shifts, setShifts] = useState<HrAttendanceShiftDto[]>([]);
  const [assignShiftId, setAssignShiftId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [assigning, setAssigning] = useState(false);
  /** Keyed by employee: the confirmation belongs to the person it was earned for, not the panel. */
  const [assignMessage, setAssignMessage] = useState<{ employeeId: string; text: string } | null>(
    null,
  );
  /** Guards against an earlier roster (older search text or week) landing after a newer one. */
  /** The `today` the assign default was derived from, so a rollover can tell default from edit. */
  const defaultDayRef = useRef(today);

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  // The remount used to re-derive the effective-from default; without it, a pane left open past
  // Tashkent midnight would assign shifts from a date already in the past. Only the untouched
  // default follows the rollover — a date the operator typed is theirs.
  useEffect(() => {
    const previous = defaultDayRef.current;
    defaultDayRef.current = today;
    setEffectiveFrom((current) => (current === previous ? today : current));
  }, [today]);

  /**
   * The roster, through the shared stale-while-revalidate store.
   *
   * The key carries every input that changes the answer, so each week and each search term keeps its
   * own entry and going back to one is instant. Crucially a refetch never clears `data`: the DWH sync
   * fires on page open and again on every week change, and without this the roster blanked to a
   * loader — or to "Could not reach the backend" — while it ran.
   *
   * No AbortSignal on purpose: passing one opts this GET out of the transport's single controlled
   * retry, which is what recovers the team route's 503 DB flaps. The hook's own run-id guard already
   * discards superseded responses, which is what the removed sequence ref was for.
   */
  const roster = useCachedLoad<AttendanceTeamListDto>(
    `hr:attendance:team:${scope}:${weekOf}:${qDebounced}`,
    () =>
      getAttendanceTeam({
        weekOf,
        scope,
        ...(qDebounced ? { q: qDebounced } : {}),
      }),
  );
  const data = roster.data;
  const loading = roster.loading;
  /**
   * Kept apart from `roster.error`, which the cache hook owns.
   *
   * These are the SIDE operations — loading the shift list, opening a person, assigning a shift. They
   * used to share the roster's error slot, so a failed shift assignment and an unreachable roster were
   * indistinguishable, and a successful roster refetch silently wiped the message telling you the
   * assignment had failed.
   */
  const [actionError, setActionError] = useState('');

  // Refresh is a force: same key, but the user asked for a round trip rather than the cached copy.
  const firstToken = useRef(refreshToken);
  useEffect(() => {
    if (refreshToken === firstToken.current) return;
    firstToken.current = refreshToken;
    roster.reload();
  }, [refreshToken, roster]);

  // Re-runs on Refresh: shifts are created/deactivated on HR → Settings while this pane stays
  // mounted, and without the old remount `key` nothing else would pick them up. `cancelled`
  // keeps overlapping re-runs from landing out of order.
  useEffect(() => {
    let cancelled = false;
    void listAttendanceShifts()
      .then((items) => {
        if (cancelled) return;
        const active = items.filter((shift) => shift.isActive);
        setShifts(active);
        // Keep the operator's pick only while it is still assignable — a shift deactivated
        // since mount would otherwise stay the <select>'s value with no matching option and
        // still submit.
        setAssignShiftId((current) =>
          active.some((shift) => shift.id === current) ? current : active[0]?.id || '',
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setActionError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    if (!selectedId || !data) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getAttendanceSummary({
      from: data.from,
      to: data.to,
      employeeId: selectedId,
    })
      .then((summary) => {
        if (!cancelled) setDetail(summary);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setActionError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, data]);

  // The roster is server-filtered, so the open person can legitimately drop out of `data.items`
  // on the next search or week. The fresh row wins when present (so the assign refresh updates
  // the shift line); the picked row keeps the name on screen, because an assign target whose
  // name is nowhere in the panel reads as a write against the wrong employee.
  /**
   * Counts for the tab's summary row. Derived from the roster we already hold rather than asked for
   * separately — the numbers must agree with the rows underneath them, and a second endpoint is a
   * second chance for them not to.
   */
  useEffect(() => {
    if (!onSummary) return;
    const items = data?.items ?? [];
    onSummary({
      people: items.length,
      inOffice: items.filter((item) => item.currentState === 'in_office').length,
      needsReview: items.filter((item) => item.currentState === 'needs_review').length,
      noShift: items.filter((item) => !item.shift).length,
    });
  }, [data, onSummary]);

  const shiftOptions: HrSelectOption[] = shifts.map((shift) => ({
    value: shift.id,
    label: `${shift.name} · ${shift.startLocal}–${shift.endLocal}`,
  }));

  const selected: AttendanceTeamListItem | null =
    data?.items.find((i) => i.employeeId === selectedId) ?? selectedEmp;

  const assignSelectedShift = async (): Promise<void> => {
    if (!selectedId || !assignShiftId || assigning) return;
    setAssigning(true);
    setAssignMessage(null);
    setActionError('');
    try {
      await assignAttendanceShift(assignShiftId, {
        employeeIds: [selectedId],
        effectiveFrom,
      });
      const assignedShift = shifts.find((shift) => shift.id === assignShiftId);
      setAssignMessage({
        employeeId: selectedId,
        text: `${assignedShift?.name ?? 'Shift'} assigned from ${effectiveFrom}.`,
      });
      // A retroactive assignment changes which DAY existing overnight punches belong to, so the
      // roster's numbers are stale the moment this returns.
      roster.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssigning(false);
    }
  };

  const emptyBody = orgWide
    ? 'No Active employees match this search.'
    : scope === 'direct'
      ? 'No direct reports yet. Ask HR to set reporting lines, or open All if you have org-wide access.'
      : 'No people in departments you lead. Confirm leadership on the department, or ask HR to set reporting lines.';

  return (
    <div className="hr-att-team">
      <div className="hr-att-toolbar">
        <label className="hr-att-search" data-focus-shell>
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={orgWide ? 'Search everyone…' : 'Search team…'}
          />
        </label>
        {data ? (
          <span className="hr-att-count">
            {data.items.length} people
            {orgWide ? ' · org-wide' : scope === 'direct' ? ' · direct reports' : ' · managed team'}
            {/* Showing a cached roster without saying so is how someone reads yesterday's numbers as
                today's. `revalidating` is the honest label while a refetch is in flight. */}
            {roster.revalidating
              ? ' · updating…'
              : roster.cachedAt
                ? ` · ${formatCachedAt(roster.cachedAt)}`
                : ''}
          </span>
        ) : null}
      </div>

      {/*
        A failed fetch only takes over the page when there is nothing behind it. With a cached roster
        still on screen it degrades to a warning, because the rows below are real — just older than the
        user asked for. This is the whole point of routing these reads through the cache.
      */}
      {roster.error && !data ? (
        <p className="hr-banner-error" role="alert">
          {roster.error}
        </p>
      ) : roster.error ? (
        <p className="hr-banner" role="status">
          <span>
            <strong>Showing the last loaded roster.</strong> Could not refresh it — {roster.error}
          </span>
        </p>
      ) : null}

      {actionError ? (
        <p className="hr-banner-error" role="alert">
          {actionError}
        </p>
      ) : null}

      {loading && !data ? (
        <HrPageLoader label="Loading attendance…" />
      ) : !data || data.items.length === 0 ? (
        <HrEmpty icon={<Users size={26} />} title="No people found" body={emptyBody} />
      ) : (
        <div className={`hr-att-split${selectedId ? ' has-detail' : ''}`}>
          <ul className="hr-att-roster" aria-label="Employees">
            {data.items.map((item) => {
              const on = item.employeeId === selectedId;
              return (
                <li key={item.employeeId}>
                  <button
                    type="button"
                    className={`hr-att-row${on ? ' is-on' : ''}`}
                    aria-current={on ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(item.employeeId);
                      setSelectedEmp(item);
                    }}
                  >
                    {/* Presence as a dot, not a pill: at 145 rows the colour is what you scan, and a
                        pill per row is 145 competing badges. The word is still on the right for
                        anyone who cannot use the colour. */}
                    <span
                      className="hr-att-row-dot"
                      data-state={item.currentState}
                      aria-hidden="true"
                    />
                    <span className="hr-att-row-main">
                      <span className="hr-att-row-name">
                        {item.firstName} {item.lastName}
                      </span>
                      <span className="hr-att-row-meta">
                        {[item.designation, item.department].filter(Boolean).join(' · ') || '—'}
                        {/* Deliberately NOT the shift name. Nearly everyone is on the same shift, so
                            printing it 145 times says nothing; its ABSENCE is the fact worth seeing. */}
                        {item.shift ? null : <em className="hr-att-row-flag">No shift</em>}
                      </span>
                    </span>
                    <span className="hr-att-row-state" data-state={item.currentState}>
                      {PRESENCE_TEXT[item.currentState] ?? 'No activity'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selectedId ? (
            <div className="hr-att-detail" role="region" aria-label="Employee attendance week">
              <header className="hr-att-detail-head">
                <div>
                  <h3>{selected ? `${selected.firstName} ${selected.lastName}` : 'Employee'}</h3>
                  {selected?.shift ? (
                    <p>
                      {selected.shift.name} [{selected.shift.startLocal} – {selected.shift.endLocal}
                      ]
                    </p>
                  ) : (
                    <p>No shift assigned</p>
                  )}
                </div>
                <button
                  type="button"
                  className="hr-icon-btn"
                  aria-label="Close"
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedEmp(null);
                  }}
                >
                  <X size={16} />
                </button>
              </header>
              <div className="hr-att-assign">
                <span className="hr-att-assign-icon">
                  <CalendarClock size={17} aria-hidden="true" />
                </span>
                <div className="hr-att-assign-copy">
                  <strong>Assign work shift</strong>
                  <span>Applies from the effective date on the Tashkent calendar.</span>
                </div>
                <label>
                  <span>Shift</span>
                  <HrSelect
                    label="Shift"
                    value={assignShiftId}
                    onChange={setAssignShiftId}
                    options={shiftOptions}
                    placeholder="Choose shift"
                  />
                </label>
                <label>
                  <span>Effective from</span>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="hr-btn hr-btn-primary"
                  disabled={!assignShiftId || assigning}
                  onClick={() => void assignSelectedShift()}
                >
                  {assigning ? 'Assigning…' : 'Assign shift'}
                </button>
              </div>
              {assignMessage && assignMessage.employeeId === selectedId ? (
                <p className="hr-att-assign-ok">{assignMessage.text}</p>
              ) : null}
              {detailLoading && !detail ? (
                <HrBusy label="Loading week…" />
              ) : detail ? (
                <HrAttendanceWeek data={detail} today={today} />
              ) : null}
            </div>
          ) : (
            <div className="hr-att-detail-placeholder">
              <Users size={22} aria-hidden="true" />
              <p>Select a person to see their week and assign a shift.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
