/**
 * Shared week day-list + totals used by My Data and the Team detail panel.
 */
import type { AttendanceSummaryDto } from '../../api/hr';

function weekdayLabel(iso: string, today: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  if (iso === today) return `Today ${String(d).padStart(2, '0')}`;
  return `${names[dow]} ${String(d).padStart(2, '0')}`;
}

function shiftTimelineTicks(startLocal: string, endLocal: string): string[] {
  const toMin = (s: string): number => {
    const [h, m] = s.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const start = toMin(startLocal);
  let end = toMin(endLocal);
  if (end <= start) end += 24 * 60;
  const ticks: string[] = [];
  for (let t = start; t <= end; t += 60) {
    const mins = t % (24 * 60);
    const h = Math.floor(mins / 60);
    const am = h < 12;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    ticks.push(`${String(h12).padStart(2, '0')}${am ? 'AM' : 'PM'}`);
  }
  return ticks;
}

export function HrAttendanceWeek({
  data,
  today,
}: {
  data: AttendanceSummaryDto;
  today: string;
}) {
  const ticks = data.shift
    ? shiftTimelineTicks(data.shift.startLocal, data.shift.endLocal)
    : ['07PM', '09PM', '11PM', '01AM', '03AM'];

  return (
    <>
      {data.lastPunch ? (
        <p className="hr-att-last">
          Last punch · {data.lastPunch.kind.replace('_', '-')} ·{' '}
          {new Date(data.lastPunch.punchedAt).toLocaleString()}
          {data.lastPunch.doorName ? ` · ${data.lastPunch.doorName}` : ''}
        </p>
      ) : null}

      <ul className="hr-att-days">
        {data.days.map((day) => {
          const isToday = day.date === today;
          return (
            <li
              key={day.date}
              className={`hr-att-day${isToday ? ' is-today' : ''} is-${day.status.toLowerCase()}`}
            >
              <span className="hr-att-daylabel">{weekdayLabel(day.date, today)}</span>
              <div className="hr-att-track">
                <div className="hr-att-bar" data-status={day.status}>
                  <span className="hr-att-badge">{day.status}</span>
                </div>
                <div className="hr-att-ticks" aria-hidden="true">
                  {ticks.map((t) => (
                    <span key={`${day.date}-${t}`}>{t}</span>
                  ))}
                </div>
              </div>
              <span className="hr-att-hours">{day.hoursWorked} Hrs worked</span>
            </li>
          );
        })}
      </ul>

      <footer className="hr-att-totals">
        <div>
          <strong>{data.totals.payableDays}</strong>
          <span>Payable Days</span>
        </div>
        <div>
          <strong>{data.totals.present}</strong>
          <span>Present</span>
        </div>
        <div>
          <strong>{data.totals.onDuty}</strong>
          <span>On Duty</span>
        </div>
        <div>
          <strong>{data.totals.paidLeave}</strong>
          <span>Paid leave</span>
        </div>
        <div>
          <strong>{data.totals.holidays}</strong>
          <span>Holidays</span>
        </div>
        <div>
          <strong>{data.totals.weekend}</strong>
          <span>Weekend</span>
        </div>
        {data.shift ? (
          <div className="hr-att-totals-shift">
            {data.shift.name} [ {data.shift.startLocal} – {data.shift.endLocal} ]
          </div>
        ) : null}
      </footer>
    </>
  );
}
