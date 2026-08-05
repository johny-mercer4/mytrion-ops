/**
 * HR → Attendance: My Data, Team (managers), and All (HR Manager / Admin).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import {
  getMyAttendance,
  type AttendanceSummaryDto,
  type AttendanceTeamScope,
} from '../../../api/hr';
import { isAdmin } from '../../../access/resolveAccess';
import { useUserContext } from '../../../context/UserContextProvider';
import type { UserContext } from '../../../context/userContext';
import { HrAttendanceTeam } from '../HrAttendanceTeam';
import { HrAttendanceWeek } from '../HrAttendanceWeek';
import { HrEmpty, HrPageLoader, HrPageHead } from '../HrBits';
import { tashkentToday, weekRangeContaining } from '../attendanceTime';

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

type AttPane = 'me' | 'team' | 'all';

function canViewOrgAttendance(user: UserContext): boolean {
  return (
    isAdmin(user) ||
    user.profile.toLowerCase().includes('hr manager') ||
    user.role.toLowerCase().includes('hr manager')
  );
}

export function HrAttendance() {
  const user = useUserContext();
  const canViewOrganization = canViewOrgAttendance(user);
  const [today, setToday] = useState(() => tashkentToday());
  const [pane, setPane] = useState<AttPane>(() => (canViewOrganization ? 'all' : 'me'));
  const [weekOf, setWeekOf] = useState(today);
  const [data, setData] = useState<AttendanceSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teamKey, setTeamKey] = useState(0);
  /** Guards against an earlier week's response landing after a newer one. */
  const seqRef = useRef(0);

  /** The Tashkent date the view is synced to; a ref so the timer and Refresh share one baseline. */
  const knownDayRef = useRef(today);

  // The tab is left open across Tashkent midnights (overnight shifts, idle tabs), so the
  // date is re-derived instead of frozen at mount. `weekOf` only follows the rollover when
  // it still points at the old "today" — a user parked on an older week keeps their spot.
  const syncToday = useCallback((): void => {
    const next = tashkentToday();
    if (next === knownDayRef.current) return;
    const previous = knownDayRef.current;
    knownDayRef.current = next;
    setToday(next);
    setWeekOf((w) => (w === previous ? next : w));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(syncToday, 60_000);
    document.addEventListener('visibilitychange', syncToday);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', syncToday);
    };
  }, [syncToday]);

  const teamScope: AttendanceTeamScope =
    pane === 'all' || (!canViewOrganization && pane === 'team') ? 'all' : 'direct';

  const loadMe = useCallback(async (): Promise<void> => {
    // No AbortSignal on purpose: passing one opts this GET out of the transport's de-dup
    // and its single controlled retry, which is what recovers the route's 503 DB flaps.
    const seq = ++seqRef.current;
    setLoading(true);
    setError('');
    try {
      const summary = await getMyAttendance({ weekOf });
      if (seq !== seqRef.current) return;
      setData(summary);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [weekOf]);

  useEffect(() => {
    if (pane !== 'me') return;
    void loadMe();
  }, [pane, loadMe]);

  const weekRange = useMemo(() => weekRangeContaining(weekOf), [weekOf]);
  // Always the REQUESTED week, never the response's — otherwise the label lags a whole
  // round trip behind the arrows and, after a raced response, stays on the wrong week.
  const rangeLabel = `${weekRange.from} — ${weekRange.to}`;

  return (
    <div className="hr-page">
      <HrPageHead
        tab="attendance"
        actions={
          <button
            type="button"
            className="hr-btn"
            disabled={pane === 'me' ? loading : false}
            onClick={() => {
              // Refresh has to re-derive the date too, not just refetch: the Team/All pane no
              // longer remounts, so a click is the user's way to correct a view that has sat
              // through a midnight and is showing the wrong day as "today".
              syncToday();
              if (pane === 'me') void loadMe();
              else setTeamKey((k) => k + 1);
            }}
          >
            <RefreshCw size={14} className={pane === 'me' && loading ? 'hr-spin' : undefined} />
            Refresh
          </button>
        }
      />

      <div className="hr-att-chrome">
        <div className="hr-att-panes" role="tablist" aria-label="Attendance views">
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'me'}
            className={`hr-att-pane${pane === 'me' ? ' is-on' : ''}`}
            onClick={() => setPane('me')}
          >
            My Data
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pane === 'team'}
            className={`hr-att-pane${pane === 'team' ? ' is-on' : ''}`}
            onClick={() => setPane('team')}
          >
            Team
          </button>
          {canViewOrganization ? (
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'all'}
              className={`hr-att-pane${pane === 'all' ? ' is-on' : ''}`}
              onClick={() => setPane('all')}
            >
              All
            </button>
          ) : null}
        </div>

        {/* The arrows stay live during a fetch: `seqRef` discards superseded responses, so hops can
            be queued (four quick clicks back a month) instead of costing one round trip each. */}
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
      </div>

      {pane === 'me' ? (
        <>
          <div className="hr-att-toolbar hr-att-toolbar-me">
            {data?.shift ? (
              <div className="hr-att-shiftchip">
                {data.shift.name}{' '}
                <span>
                  [ {data.shift.startLocal} – {data.shift.endLocal} ]
                </span>
              </div>
            ) : (
              <div className="hr-att-shiftchip is-muted">No shift assigned</div>
            )}
          </div>

          {error ? (
            <p className="hr-banner-error" role="alert">
              {error}
            </p>
          ) : null}

          {loading && !data ? (
            <HrPageLoader label="Loading attendance…" />
          ) : !data ? (
            <HrEmpty
              icon={<CalendarClock size={26} />}
              title="No attendance data"
              body="Link your Zoho sign-in to an employee record, and ensure Ganga punches are mapped to your profile."
            />
          ) : (
            // A refetch keeps the populated week on screen and just dims it — a second
            // full-surface loader next to the spinning Refresh icon is the double-loader bug.
            // The wrapper re-states `.hr-page`'s column gap it would otherwise swallow.
            <div
              aria-busy={loading}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--hr-gap-lg)',
                opacity: loading ? 0.55 : 1,
                transition: 'opacity var(--hz-dur-tone) var(--hz-ease)',
              }}
            >
              <HrAttendanceWeek data={data} today={today} />
            </div>
          )}
        </>
      ) : (
        // Keyed on `pane` only. Refresh goes through refreshToken instead of the key, so it refetches
        // the roster without remounting away the open person, the search text and the scroll. `today`
        // is threaded down for the same reason: nothing there re-derives it on its own any more.
        <HrAttendanceTeam
          key={pane}
          scope={teamScope}
          today={today}
          weekOf={weekOf}
          orgWide={pane === 'all'}
          refreshToken={teamKey}
        />
      )}
    </div>
  );
}
