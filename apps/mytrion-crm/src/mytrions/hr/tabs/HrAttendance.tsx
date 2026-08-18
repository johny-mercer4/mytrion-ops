/**
 * HR → Attendance: My Data, Team (managers), and All (HR Manager / Admin).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  RefreshCw,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import {
  getMyAttendance,
  syncAttendanceFromDwh,
  type AttendanceTeamScope,
} from '../../../api/hr';
import { hasFullHrAccess, isAdmin } from '../../../access/resolveAccess';
import { useUserContext } from '../../../context/UserContextProvider';
import type { UserContext } from '../../../context/userContext';
import { HrAttendanceTeam, type TeamSummary } from '../HrAttendanceTeam';
import { HrAttendanceWeek } from '../HrAttendanceWeek';
import { HrEmpty, HrPageLoader, HrPageHead, HrSummaryTiles } from '../HrBits';
import { invalidateSwrCache, useCachedLoad } from '../../_shared/swrCache';
import { tashkentToday, weekRangeContaining } from '../attendanceTime';

function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Two views, not three.
 *
 * There used to be a separate `team` tab pinned to `scope: 'direct'` — literally the caller's own
 * direct reports. For an Administrator that is almost always empty (admins are rarely anyone's
 * manager), so it read as a broken tab; and for a manager it was a strictly smaller slice of what the
 * roster already shows. One roster, always `scope: 'all'`, and the SERVER decides what "all" means for
 * the caller: every Active employee for HR/Admin, reportees ∪ led departments for a manager. That is
 * why removing the tab does not remove a manager's access to their team — it is the same query.
 */
type AttPane = 'me' | 'roster';

/** The same wording the day rows and the roster use, so one state is not named three ways. */
const PRESENCE_LABEL: Record<string, string> = {
  in_office: 'In office',
  out_of_office: 'Out of office',
  needs_review: 'Needs review',
  no_activity: 'No activity',
};

/** Sees EVERYONE's attendance ("All"): admins and HR Managers. Mirrors the backend `canViewAllAttendance`. */
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
  // Who has a roster at all: HR staff (the hr grant, via hasFullHrAccess) and team leads see one — HR
  // its whole managed reach, a lead their team. A plain employee has none, so they get only My Data,
  // and the Excel export (roster + person) rides on the same gate.
  const canSeeRoster = hasFullHrAccess(user) || user.leadsTeam === true;
  const [today, setToday] = useState(() => tashkentToday());
  const [pane, setPane] = useState<AttPane>(() =>
    canViewOrganization && canSeeRoster ? 'roster' : 'me',
  );
  const [weekOf, setWeekOf] = useState(today);
  const [teamKey, setTeamKey] = useState(0);
  const [teamSummary, setTeamSummary] = useState<TeamSummary | null>(null);
  /**
   * The roster tile says WHICH roster, so "12 people" is never ambiguous.
   *
   * Keyed off the caller's reach rather than the pane, now that there is only one roster: the same tab
   * is everyone's directory for HR/Admin and just your own team for a manager.
   */
  const orgWide = canViewOrganization;
  const orgWideLabel = orgWide ? 'Everyone' : 'Your team';

  /**
   * The pane actually rendered.
   *
   * A user with no roster — a plain employee, or a View-as target who is neither HR nor a team lead —
   * has only My Data. So a `pane` left on 'roster' (by a prior View-as identity, or an over-eager
   * init) collapses back to 'me'. `meLoad`, the summary tiles and the body ALL key off this one value,
   * which is the fix for the View-as bug where My Data rendered but its fetch was gated off (`enabled:
   * pane === 'me'`) because `pane` was stuck on 'roster' — a permanent "No attendance data" for a user
   * whose punches were sitting right there, plus the previous identity's org tiles bleeding through.
   */
  const effectivePane: AttPane = canSeeRoster ? pane : 'me';

  /**
   * Switching panes drops the counts on the way out.
   *
   * The roster component is keyed on `pane`, so it remounts and refetches — but the tab's copy of the
   * numbers would survive that gap, showing All's totals under "Your team" until the new roster landed.
   * Stale numbers with a confident new label are worse than no numbers.
   */
  const choosePane = useCallback((next: AttPane): void => {
    setPane(next);
    setTeamSummary(null);
  }, []);
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

  // Always 'all'. The server scopes it to the caller — see the `AttPane` note.
  const teamScope: AttendanceTeamScope = 'all';

  /**
   * Punches come from the DWH, and this is what asks for them.
   *
   * Runs ALONGSIDE the read rather than before it, which is the whole design. Blocking the first paint
   * on an analytics query would trade a page that loads for a page that waits, every visit, to be told
   * nothing changed — the common case, since the server holds a completed sync for a minute. So: show
   * what is stored immediately, and only re-read when the sync says it actually wrote something.
   *
   * A failure here is deliberately swallowed into a note. Attendance that is an hour stale is worth
   * reading; an error page because a shared analytics database was busy is not.
   */
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const runSync = useCallback(
    async (range: { from: string; to: string }, force = false): Promise<boolean> => {
      setSyncing(true);
      setSyncNote('');
      try {
        const result = await syncAttendanceFromDwh({ from: range.from, to: range.to, force });
        // A forced refresh re-reads even when nothing new arrived: the user pressed the button, and
        // "I checked and it is unchanged" has to look different from "I ignored you".
        return result.inserted > 0 || force;
      } catch (err) {
        setSyncNote(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  /**
   * My Data, through the shared stale-while-revalidate store.
   *
   * Was a hand-rolled `useState` + fetch, which blanked the week to a loader on every visit and to an
   * error on every hiccup — including the DWH refresh firing alongside it. The cache paints the last
   * known week instantly and a refetch never clears what is on screen, so the pull from the warehouse
   * happens behind data the user can already read.
   *
   * `enabled` keeps the roster pane from fetching this, but the hook still adopts a cached value, so
   * switching back to My Data is instant.
   */
  const meLoad = useCachedLoad(
    `hr:attendance:me:${weekOf}`,
    // No AbortSignal on purpose: passing one opts this GET out of the transport's de-dup and its
    // single controlled retry, which is what recovers the route's 503 DB flaps.
    () => getMyAttendance({ weekOf }),
    { enabled: effectivePane === 'me' },
  );
  const data = meLoad.data;
  const loading = meLoad.loading;
  const error = meLoad.error ?? '';

  const weekRange = useMemo(() => weekRangeContaining(weekOf), [weekOf]);
  // Always the REQUESTED week, never the response's — otherwise the label lags a whole
  // round trip behind the arrows and, after a raced response, stays on the wrong week.
  const rangeLabel = `${weekRange.from} — ${weekRange.to}`;

  /**
   * The warehouse wrote something, so re-read — WITHOUT taking the current numbers off screen.
   *
   * One prefix invalidation covers both panes and every cached week, because the store notifies by
   * key prefix: subscribers refetch while still rendering their last value. That is the whole reason
   * the sync can run on page open at all. Bumping a remount key instead (which is what this did) threw
   * the roster's open person, search text and scroll position away every time a punch arrived.
   */
  const revalidate = useCallback((): void => {
    invalidateSwrCache('hr:attendance:');
  }, []);

  /**
   * NOTHING is pulled from the warehouse on page load any more.
   *
   * It used to sync the whole week for everyone here, which is ~4.4k rows and was slow enough to hit
   * the request timeout — a warning banner on every visit for work the visit did not need. Opening one
   * person pulls only that person (tens of rows), which is where the data is actually looked at, and
   * Refresh still pulls the whole window when the tiles are what you came for.
   *
   * The roster and My Data render from what is already stored, so the page is as fast as one database
   * read and never waits on the DWH.
   */

  return (
    /* The Team pane is a roster + detail split — wide content that a reading measure only squeezes.
       Same opt-out the org canvas and the directory lists use. */
    <div className="hr-page hr-page-wide">
      <HrPageHead
        tab="attendance"
        actions={
          <button
            type="button"
            className="hr-btn"
            disabled={syncing || (effectivePane === 'me' && loading)}
            onClick={() => {
              // Refresh has to re-derive the date too, not just refetch: the Team/All pane no
              // longer remounts, so a click is the user's way to correct a view that has sat
              // through a midnight and is showing the wrong day as "today".
              syncToday();
              // The whole window, on purpose: this is the one place that refreshes the roster's
              // presence and the tiles above it, and the user asked for it and is watching.
              void runSync(weekRange, true).then(() => {
                revalidate();
                // The roster's shift list is not in the cache, and Refresh is the only thing that
                // reloads it after shifts are edited on HR → Settings with this pane still mounted.
                setTeamKey((k) => k + 1);
              });
            }}
          >
            <RefreshCw
              size={14}
              className={syncing || (effectivePane === 'me' && loading) ? 'hr-spin' : undefined}
            />
            Refresh
          </button>
        }
      />

      {/*
        A failed refresh is a warning, not an error: everything below is real, just possibly missing the
        last few punches. `role="status"` rather than `alert` for the same reason — it should not
        interrupt a screen reader mid-sentence to report that a background job was unlucky.
      */}
      {syncNote ? (
        <p className="hr-banner" role="status">
          <AlertTriangle size={15} />
          <span>
            <strong>Showing stored attendance.</strong> Could not reach the data warehouse for the
            latest punches — {syncNote}
          </span>
        </p>
      ) : null}

      {/*
        The same KPI row every other HR tab opens with. Which numbers depend on the pane: My Data is a
        week of one person, Team/All is a roster right now. Rendered only once there is something to
        count — tiles reading 0 over a failed or pending load are a measurement, not a blank.
      */}
      {effectivePane === 'me' && data ? (
        <HrSummaryTiles
          label="My attendance summary"
          items={[
            {
              label: 'Right now',
              value: PRESENCE_LABEL[data.currentState] ?? '—',
              detail: 'Live from the Ganga readers',
              icon: <DoorOpen size={19} />,
              tone: data.currentState === 'in_office' ? 'var(--success)' : 'var(--tone-blue)',
            },
            {
              label: 'Days present',
              value: data.totals.present,
              detail: 'Office visits this week',
              icon: <UserCheck size={19} />,
              tone: 'var(--success)',
            },
            {
              label: 'Days absent',
              value: data.totals.absent,
              detail: 'Scheduled, no entry scan',
              icon: <UserMinus size={19} />,
              tone: data.totals.absent ? 'var(--warning)' : 'var(--text-muted)',
            },
            {
              label: 'Unscheduled',
              value: data.totals.unscheduled,
              detail: 'Days with no shift assigned',
              icon: <CalendarX size={19} />,
              tone: data.totals.unscheduled ? 'var(--warning)' : 'var(--text-muted)',
            },
          ]}
        />
      ) : null}

      {effectivePane !== 'me' && teamSummary ? (
        <HrSummaryTiles
          label="Team attendance summary"
          items={[
            {
              label: orgWideLabel,
              value: teamSummary.people,
              detail: 'Active people in this view',
              icon: <Users size={19} />,
              tone: 'var(--tone-blue)',
            },
            {
              label: 'In office now',
              value: teamSummary.inOffice,
              detail: 'Checked in, not yet out',
              icon: <DoorOpen size={19} />,
              tone: 'var(--success)',
            },
            {
              label: 'Needs review',
              value: teamSummary.needsReview,
              detail: 'A visit with no checkout',
              icon: <AlertTriangle size={19} />,
              tone: teamSummary.needsReview ? 'var(--warning)' : 'var(--text-muted)',
            },
            {
              label: 'No shift',
              value: teamSummary.noShift,
              detail: 'Attendance cannot be scored',
              icon: <CalendarX size={19} />,
              tone: teamSummary.noShift ? 'var(--warning)' : 'var(--text-muted)',
            },
          ]}
        />
      ) : null}

      <div className="hr-att-chrome">
        {/* A regular employee has only their own data, so there is no view to choose — the pane
            switcher appears only for someone who can also see a team or the whole org. */}
        {canSeeRoster ? (
          <div className="hr-att-panes" role="tablist" aria-label="Attendance views">
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'me'}
              className={`hr-att-pane${pane === 'me' ? ' is-on' : ''}`}
              onClick={() => choosePane('me')}
            >
              My Data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'roster'}
              className={`hr-att-pane${pane === 'roster' ? ' is-on' : ''}`}
              onClick={() => choosePane('roster')}
            >
              {orgWide ? 'All' : 'Team'}
            </button>
          </div>
        ) : null}

        {/* The arrows stay live during a fetch: the cache hook's run-id guard discards superseded
            responses, and each week keeps its own entry — so four quick clicks back a month are three
            instant paints and one fetch, not four round trips. */}
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

      {effectivePane === 'me' ? (
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

          {/* Same rule as the roster: a failed refresh only takes the page when there is nothing
              cached behind it. Otherwise the week below is real, just older. */}
          {error && !data ? (
            <p className="hr-banner-error" role="alert">
              {error}
            </p>
          ) : error ? (
            <p className="hr-banner" role="status">
              <span>
                <strong>Showing your last loaded week.</strong> Could not refresh it — {error}
              </span>
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
        // Keyed on pane + the effective identity: a View-as switch remounts the roster as the new
        // user, so one identity's org totals never linger under another's name. Refresh goes through
        // refreshToken instead of the key, so it refetches the roster without remounting away the open
        // person, the search text and the scroll. `today` is threaded down for the same reason:
        // nothing there re-derives it on its own any more.
        <HrAttendanceTeam
          key={`${pane}:${user.userId}`}
          scope={teamScope}
          today={today}
          weekOf={weekOf}
          orgWide={orgWide}
          refreshToken={teamKey}
          onSummary={setTeamSummary}
        />
      )}
    </div>
  );
}
