/**
 * Team attendance — department managers see reportees / dept members;
 * HR Manager + Admin see the org (All).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Users, X } from 'lucide-react';
import {
  getAttendanceSummary,
  getAttendanceTeam,
  type AttendanceSummaryDto,
  type AttendanceTeamListDto,
  type AttendanceTeamListItem,
  type AttendanceTeamScope,
} from '../../api/hr';
import { HrBusy, HrEmpty } from './HrBits';
import { HrAttendanceWeek } from './HrAttendanceWeek';

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function HrAttendanceTeam() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [weekOf, setWeekOf] = useState(today);
  const [scope, setScope] = useState<AttendanceTeamScope>('direct');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [data, setData] = useState<AttendanceTeamListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AttendanceSummaryDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const rangeLabel = data ? `${data.from} — ${data.to}` : weekOf;

  return (
    <div className="hr-att-team">
      <div className="hr-att-toolbar">
        <div className="hr-att-scope" role="group" aria-label="Team scope">
          <button
            type="button"
            className={`hr-att-scope-btn${scope === 'direct' ? ' is-on' : ''}`}
            onClick={() => setScope('direct')}
          >
            Direct {data?.counts.direct ?? '·'}
          </button>
          <button
            type="button"
            className={`hr-att-scope-btn${scope === 'all' ? ' is-on' : ''}`}
            onClick={() => setScope('all')}
          >
            All {data?.counts.all ?? '·'}
          </button>
        </div>

        <div className="hr-att-weeknav">
          <button
            type="button"
            className="hr-icon-btn"
            aria-label="Previous week"
            onClick={() => setWeekOf((w) => addDays(w, -7))}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="hr-att-weeklabel">{rangeLabel}</span>
          <button
            type="button"
            className="hr-icon-btn"
            aria-label="Next week"
            onClick={() => setWeekOf((w) => addDays(w, 7))}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <label className="hr-att-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search employees"
          />
        </label>
      </div>

      {data?.canViewAll ? (
        <p className="hr-att-scope-hint">
          HR Manager / Admin — <strong>All</strong> shows every Active employee across departments.
        </p>
      ) : (
        <p className="hr-att-scope-hint">
          <strong>Direct</strong> = people who report to you. <strong>All</strong> also includes
          members of departments you lead.
        </p>
      )}

      {error ? (
        <p className="hr-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <HrBusy label="Loading team attendance…" />
      ) : !data || data.items.length === 0 ? (
        <HrEmpty
          icon={<Users size={26} />}
          title="No team members found"
          body={
            scope === 'direct'
              ? 'No direct reportees yet. Try All if you lead a department, or ask HR to set reporting lines.'
              : 'Try adjusting your search, or confirm you are set as a department lead / manager.'
          }
        />
      ) : (
        <ul className="hr-att-team-grid">
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
                    <em>{item.totals.absent}</em> absent
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedId ? (
        <div className="hr-att-detail" role="dialog" aria-label="Employee attendance week">
          <header className="hr-att-detail-head">
            <div>
              <h3>
                {selected
                  ? `${selected.firstName} ${selected.lastName}`
                  : 'Employee'}
              </h3>
              {selected?.shift ? (
                <p>
                  {selected.shift.name} [ {selected.shift.startLocal} – {selected.shift.endLocal} ]
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
          {detailLoading && !detail ? (
            <HrBusy label="Loading week…" />
          ) : detail ? (
            <HrAttendanceWeek data={detail} today={today} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
