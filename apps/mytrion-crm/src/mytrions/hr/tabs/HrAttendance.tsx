/**
 * HR → Attendance: My Data, Team (managers), and All (HR Manager / Admin).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const today = useMemo(() => tashkentToday(), []);
  const [pane, setPane] = useState<AttPane>(() => (canViewOrganization ? 'all' : 'me'));
  const [weekOf, setWeekOf] = useState(today);
  const [data, setData] = useState<AttendanceSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teamKey, setTeamKey] = useState(0);

  const teamScope: AttendanceTeamScope =
    pane === 'all' || (!canViewOrganization && pane === 'team') ? 'all' : 'direct';

  const loadMe = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const summary = await getMyAttendance({ weekOf });
      setData(summary);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [weekOf]);

  useEffect(() => {
    if (pane !== 'me') return;
    void loadMe();
  }, [pane, loadMe]);

  const weekRange = useMemo(() => weekRangeContaining(weekOf), [weekOf]);
  const rangeLabel =
    data && pane === 'me' ? `${data.from} — ${data.to}` : `${weekRange.from} — ${weekRange.to}`;

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
            <HrAttendanceWeek data={data} today={today} />
          )}
        </>
      ) : (
        <HrAttendanceTeam
          key={`${pane}-${teamKey}`}
          scope={teamScope}
          weekOf={weekOf}
          orgWide={pane === 'all'}
        />
      )}
    </div>
  );
}
