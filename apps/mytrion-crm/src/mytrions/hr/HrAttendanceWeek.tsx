/**
 * Shared attendance week used by My Data and the Team detail panel.
 * The emphasis is the real office visit: check-in, check-out, and elapsed time.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, DoorOpen, LogIn, LogOut } from 'lucide-react';
import type { AttendanceDayRow, AttendanceSummaryDto } from '../../api/hr';

const MAX_LIVE_SESSION_MS = 16 * 60 * 60 * 1000;

function weekdayLabel(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return iso === today
    ? `Today · ${String(d).padStart(2, '0')}`
    : `${names[dow]} · ${String(d).padStart(2, '0')}`;
}

function durationLabel(ms: number, includeSeconds = false): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (includeSeconds) {
    return hours > 0
      ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
      : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function sessionDurationMs(session: AttendanceDayRow['sessions'][number], nowMs: number): number {
  if (session.status === 'complete') return session.durationMs;
  if (session.status === 'needs_review') return 0;
  const elapsed = nowMs - Date.parse(session.checkInAt);
  return elapsed >= 0 && elapsed <= MAX_LIVE_SESSION_MS ? elapsed : 0;
}

function dayDurationMs(day: AttendanceDayRow, nowMs: number): number {
  return day.sessions.reduce((total, session) => total + sessionDurationMs(session, nowMs), 0);
}

function statusLabel(day: AttendanceDayRow): string {
  if (day.currentState === 'in_office') return 'Inside now';
  if (day.currentState === 'needs_review') return 'Needs review';
  return day.status;
}

export function HrAttendanceWeek({ data, today }: { data: AttendanceSummaryDto; today: string }) {
  const [nowMs, setNowMs] = useState(() => Date.parse(data.calculatedAt) || Date.now());
  const hasOpenSession = data.days.some((day) =>
    day.sessions.some((session) => session.status === 'open'),
  );

  useEffect(() => {
    setNowMs(Date.now());
    if (!hasOpenSession) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [data.calculatedAt, hasOpenSession]);

  const activeVisit = useMemo(() => {
    for (const day of data.days) {
      const session = day.sessions.find((item) => item.status === 'open');
      if (session) return { day, session };
    }
    return null;
  }, [data.days]);

  const todayRow = data.days.find((day) => day.date === today);
  const weeklyMs = data.days.reduce((total, day) => total + dayDurationMs(day, nowMs), 0);
  const activeMs = activeVisit ? sessionDurationMs(activeVisit.session, nowMs) : 0;
  /**
   * Which day's running total to show beside the visit.
   *
   * The open visit's own day wins over the calendar day, because those differ exactly when it matters:
   * a 19:00–03:00 shift is bucketed on the day it started, so after midnight the calendar row is a
   * fresh empty day while the shift the person is actually working sits on yesterday's.
   */
  const dayClock = activeVisit?.day ?? todayRow;
  // `currentState` / `lastPunch` come from the employee's latest punch overall, not from
  // `from..to`, so they may only decorate this card while the range still touches now: today is
  // in it, or a session inside it is still open (a visit that ran past Tashkent midnight).
  const isLiveRange = activeVisit != null || todayRow != null;
  const presenceTitle = !isLiveRange
    ? `Week of ${data.from} — ${data.to}`
    : activeVisit || data.currentState === 'in_office'
      ? 'Currently in the office'
      : data.currentState === 'needs_review'
        ? 'Checkout needs review'
        : data.currentState === 'out_of_office'
          ? 'Currently out of office'
          : 'No office activity yet';

  return (
    <>
      <section
        className="hr-att-presence"
        data-state={isLiveRange ? data.currentState : 'no_activity'}
        aria-label={isLiveRange ? 'Current office presence' : 'Week attendance summary'}
      >
        <div className="hr-att-presence-icon" aria-hidden="true">
          {activeVisit ? (
            <DoorOpen size={24} />
          ) : !isLiveRange ? (
            <Clock3 size={24} />
          ) : data.currentState === 'needs_review' ? (
            <AlertTriangle size={24} />
          ) : (
            <CheckCircle2 size={24} />
          )}
        </div>
        <div className="hr-att-presence-copy">
          <span className="hr-att-eyebrow">
            {isLiveRange ? 'Live presence · Tashkent time' : 'Week summary · Tashkent time'}
          </span>
          <h2>{presenceTitle}</h2>
          <p>
            {activeVisit
              ? `Checked in at ${activeVisit.session.checkIn} · ${activeVisit.session.checkInDoor ?? 'Ganga entry'}`
              : !isLiveRange
                ? `${data.totals.present} present · ${data.totals.absent} absent · ${durationLabel(weeklyMs)} in office`
                : data.lastPunch
                  ? `Last scan ${data.lastPunch.localDateTime} · ${data.lastPunch.doorName ?? 'Ganga reader'}`
                  : 'A Ganga entry scan will start the tracker automatically.'}
          </p>
        </div>
        {/*
          Three readings, not two. "This visit" used to REPLACE the day total while a visit was open, so
          the moment someone clocked in they lost sight of how long they had already been in today —
          which for a split shift, or anyone who stepped out and came back, is the number that matters.
        */}
        <div className="hr-att-clocks">
          {activeVisit ? (
            <div className="hr-att-live-clock">
              <span>This visit</span>
              <strong>{durationLabel(activeMs, true)}</strong>
              <small>Counting live</small>
            </div>
          ) : null}
          {dayClock ? (
            <div className="hr-att-live-clock">
              {/*
                Named for the day the total actually belongs to. An overnight shift is bucketed on the
                day it STARTED, so at 01:00 a night worker's running day is yesterday's row — calling
                that "Today" would be a plain lie, and this page is used to check payroll.
              */}
              <span>{dayClock.date === today ? 'Today' : dayClock.date}</span>
              <strong>{durationLabel(dayDurationMs(dayClock, nowMs))}</strong>
              <small>{activeVisit ? 'Including this visit' : 'Completed visits'}</small>
            </div>
          ) : null}
          <div className="hr-att-week-clock">
            <span>This week</span>
            <strong>{durationLabel(weeklyMs)}</strong>
          </div>
        </div>
      </section>

      <ul className="hr-att-days">
        {data.days.map((day) => {
          const isToday = day.date === today;
          const workedMs = dayDurationMs(day, nowMs);
          return (
            <li key={day.date} className={`hr-att-day${isToday ? ' is-today' : ''}`}>
              <header className="hr-att-day-head">
                <div>
                  <span className="hr-att-daylabel">{weekdayLabel(day.date, today)}</span>
                  <span className="hr-att-date">{day.date}</span>
                </div>
                <span className="hr-att-day-status" data-state={day.currentState}>
                  {statusLabel(day)}
                </span>
                <div className="hr-att-day-total">
                  <Clock3 size={15} aria-hidden="true" />
                  <span>In office</span>
                  <strong>{durationLabel(workedMs)}</strong>
                </div>
              </header>

              {day.sessions.length > 0 ? (
                <div className="hr-att-visits">
                  {day.sessions.map((session, index) => {
                    const visitMs = sessionDurationMs(session, nowMs);
                    return (
                      <article
                        className="hr-att-visit"
                        data-status={session.status}
                        key={`${day.date}-${session.checkInAt}-${index}`}
                      >
                        <div className="hr-att-event">
                          <span className="hr-att-event-icon">
                            <LogIn size={15} aria-hidden="true" />
                          </span>
                          <div>
                            <small>Check in</small>
                            <strong>{session.checkIn}</strong>
                            <span>{session.checkInDoor ?? 'Ganga entry'}</span>
                          </div>
                        </div>
                        <span className="hr-att-visit-line" aria-hidden="true" />
                        <div className="hr-att-event">
                          <span className="hr-att-event-icon">
                            <LogOut size={15} aria-hidden="true" />
                          </span>
                          <div>
                            <small>Check out</small>
                            <strong>
                              {session.checkOut ??
                                (session.status === 'needs_review'
                                  ? 'Missing checkout'
                                  : 'Still inside')}
                            </strong>
                            <span>
                              {session.checkOutDoor ??
                                (session.status === 'open'
                                  ? 'Waiting for Ganga exit'
                                  : 'Needs manual review')}
                            </span>
                          </div>
                        </div>
                        <div className="hr-att-visit-duration">
                          <small>
                            {session.status === 'open' ? 'Live duration' : 'Visit duration'}
                          </small>
                          <strong>
                            {session.status === 'needs_review'
                              ? '—'
                              : durationLabel(visitMs, session.status === 'open')}
                          </strong>
                        </div>
                      </article>
                    );
                  })}
                  {day.unmatchedPunches > 0 ? (
                    <p className="hr-att-unmatched">
                      <AlertTriangle size={13} aria-hidden="true" />
                      {day.unmatchedPunches} standalone scan{day.unmatchedPunches === 1 ? '' : 's'}{' '}
                      kept in the audit log but not counted as a complete visit.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="hr-att-no-visits">
                  {day.status === 'Weekend'
                    ? 'Weekend · no visit expected'
                    : day.status === 'Unscheduled'
                      ? 'No shift scheduled'
                      : 'No Ganga entry recorded'}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="hr-att-totals">
        <div>
          <strong>{data.totals.present}</strong>
          <span>Days present</span>
        </div>
        <div>
          <strong>{data.totals.absent}</strong>
          <span>Days absent</span>
        </div>
        <div>
          <strong>{data.totals.weekend}</strong>
          <span>Weekend days</span>
        </div>
        <div>
          <strong>{durationLabel(weeklyMs)}</strong>
          <span>Time in office</span>
        </div>
        {data.totals.unscheduled > 0 ? (
          <div>
            <strong>{data.totals.unscheduled}</strong>
            <span>Unscheduled</span>
          </div>
        ) : null}
        {data.shift ? (
          <div className="hr-att-totals-shift">
            {data.shift.name} · {data.shift.startLocal}–{data.shift.endLocal} UZT
          </div>
        ) : null}
      </footer>
    </>
  );
}
