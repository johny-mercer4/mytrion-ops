/**
 * Team / All attendance directory.
 * Managers: Team = reportees ∪ departments they lead.
 * Admins / HR Manager: Team = direct reports; All = every Active employee.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { HrBusy, HrEmpty, HrPageLoader } from './HrBits';
import { HrAttendanceWeek } from './HrAttendanceWeek';

export function HrAttendanceTeam({
  scope,
  today,
  weekOf,
  orgWide = false,
  refreshToken = 0,
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
}) {
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [data, setData] = useState<AttendanceTeamListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  const rosterSeqRef = useRef(0);
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

  const load = useCallback(async (): Promise<void> => {
    // No AbortSignal on purpose: passing one opts this GET out of the transport's single
    // controlled retry, which is what recovers the team route's 503 DB flaps. The sequence
    // guard does the same job for us without turning a superseded request into a rejection.
    const seq = ++rosterSeqRef.current;
    setLoading(true);
    setError('');
    try {
      const team = await getAttendanceTeam({
        weekOf,
        scope,
        ...(qDebounced ? { q: qDebounced } : {}),
      });
      if (seq !== rosterSeqRef.current) return;
      setData(team);
    } catch (err) {
      if (seq !== rosterSeqRef.current) return;
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === rosterSeqRef.current) setLoading(false);
    }
  }, [weekOf, scope, qDebounced, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
          setError(err instanceof Error ? err.message : String(err));
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
  const selected: AttendanceTeamListItem | null =
    data?.items.find((i) => i.employeeId === selectedId) ?? selectedEmp;

  const assignSelectedShift = async (): Promise<void> => {
    if (!selectedId || !assignShiftId || assigning) return;
    setAssigning(true);
    setAssignMessage(null);
    setError('');
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
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
                    className={`hr-att-person${on ? ' is-on' : ''}`}
                    onClick={() => {
                      setSelectedId(item.employeeId);
                      setSelectedEmp(item);
                    }}
                  >
                    <span className="hr-att-person-name">
                      {item.firstName} {item.lastName}
                    </span>
                    <span className="hr-att-person-meta">
                      {[item.designation, item.department].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span className="hr-att-person-stats">
                      <em>{item.totals.present}</em> present
                      <span aria-hidden="true"> · </span>
                      {item.shift ? (
                        <>
                          <em>{item.totals.absent}</em> absent
                        </>
                      ) : (
                        <em>Not scheduled</em>
                      )}
                    </span>
                    <span className="hr-att-person-presence" data-state={item.currentState}>
                      {item.currentState === 'in_office'
                        ? 'In office'
                        : item.currentState === 'needs_review'
                          ? 'Needs review'
                          : item.currentState === 'out_of_office'
                            ? 'Out of office'
                            : 'No activity'}
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
                  <select
                    value={assignShiftId}
                    onChange={(event) => setAssignShiftId(event.target.value)}
                  >
                    <option value="">Choose shift</option>
                    {shifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.name} · {shift.startLocal}–{shift.endLocal}
                      </option>
                    ))}
                  </select>
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
