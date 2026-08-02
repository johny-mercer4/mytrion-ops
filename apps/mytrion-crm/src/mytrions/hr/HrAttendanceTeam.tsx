/**
 * Team / All attendance directory.
 * Managers: Team = reportees ∪ departments they lead.
 * Admins / HR Manager: Team = direct reports; All = every Active employee.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { tashkentToday } from './attendanceTime';

export function HrAttendanceTeam({
  scope,
  weekOf,
  orgWide = false,
}: {
  scope: AttendanceTeamScope;
  weekOf: string;
  /** True when the All tab is active (org-wide directory). */
  orgWide?: boolean;
}) {
  const today = useMemo(() => tashkentToday(), []);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [data, setData] = useState<AttendanceTeamListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AttendanceSummaryDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shifts, setShifts] = useState<HrAttendanceShiftDto[]>([]);
  const [assignShiftId, setAssignShiftId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => tashkentToday());
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const team = await getAttendanceTeam({
        weekOf,
        scope,
        ...(qDebounced ? { q: qDebounced } : {}),
      });
      setData(team);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [weekOf, scope, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void listAttendanceShifts()
      .then((items) => {
        if (cancelled) return;
        const active = items.filter((shift) => shift.isActive);
        setShifts(active);
        setAssignShiftId((current) => current || active[0]?.id || '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const selected: AttendanceTeamListItem | undefined = data?.items.find(
    (i) => i.employeeId === selectedId,
  );

  const assignSelectedShift = async (): Promise<void> => {
    if (!selectedId || !assignShiftId || assigning) return;
    setAssigning(true);
    setAssignMessage('');
    setError('');
    try {
      await assignAttendanceShift(assignShiftId, {
        employeeIds: [selectedId],
        effectiveFrom,
      });
      const assignedShift = shifts.find((shift) => shift.id === assignShiftId);
      setAssignMessage(`${assignedShift?.name ?? 'Shift'} assigned from ${effectiveFrom}.`);
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
                    onClick={() => setSelectedId(item.employeeId)}
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
                  onClick={() => setSelectedId(null)}
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
              {assignMessage ? <p className="hr-att-assign-ok">{assignMessage}</p> : null}
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
