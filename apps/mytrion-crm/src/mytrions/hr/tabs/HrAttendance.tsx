import { CalendarClock, Clock3, TimerOff, UserCheck } from 'lucide-react';
import { HrPageHead, HrSection, Pill, PreviewBanner, toneFor } from '../HrBits';
import { PREVIEW_ATTENDANCE } from '../peoplePreview';

/**
 * HR → Attendance. Check-ins, hours and absence for a single day.
 *
 * A table rather than cards: attendance is scanned column-wise ("who was late?"), which a grid of
 * cards makes slow. The wrapper scrolls horizontally on narrow screens so the page body never does.
 *
 * All figures are PLACEHOLDERS. Zoho People's attendance API is a separate endpoint from the
 * employee form used for the directory — it has not been inspected yet, so the columns here are the
 * shape we expect, not a confirmed contract.
 */

const SUMMARY = [
  { label: 'Present', value: '—', icon: UserCheck, tone: 'var(--tone-emerald)' },
  { label: 'Late', value: '—', icon: Clock3, tone: 'var(--tone-amber)' },
  { label: 'Absent', value: '—', icon: TimerOff, tone: 'var(--tone-rose)' },
  { label: 'On leave', value: '—', icon: CalendarClock, tone: 'var(--tone-violet)' },
];

export function HrAttendance() {
  return (
    <div className="hr-page">
      <HrPageHead tab="attendance" />
      <PreviewBanner what="Attendance" />

      <HrSection title="Today">
        <div className="hr-stats">
          {SUMMARY.map((s) => (
            <div key={s.label} className="hr-stat" style={{ ['--hr-tone' as string]: s.tone }}>
              <span className="hr-stat-l">
                <s.icon size={12} />
                {s.label}
              </span>
              <span className="hr-stat-n">{s.value}</span>
              <span className="hr-stat-s">of all employees</span>
            </div>
          ))}
        </div>
      </HrSection>

      <HrSection title="Daily log">
        <div className="hr-table-wrap">
          <div className="hr-table-scroll">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Employee ID</th>
                  <th>Date</th>
                  <th>Check in</th>
                  <th>Check out</th>
                  <th>Hours</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {PREVIEW_ATTENDANCE.map((r) => (
                  <tr key={`${r.employeeId}-${r.date}`}>
                    <td className="hr-strong">{r.employee}</td>
                    <td className="hr-mono">{r.employeeId}</td>
                    <td className="hr-mono">{r.date}</td>
                    <td className="hr-mono">{r.checkIn}</td>
                    <td className="hr-mono">{r.checkOut}</td>
                    <td className="hr-mono">{r.hours}</td>
                    <td>
                      <Pill label={r.state} tone={toneFor(r.state)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </HrSection>
    </div>
  );
}
