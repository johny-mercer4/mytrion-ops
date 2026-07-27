import { CalendarClock } from 'lucide-react';
import { ComingSoon } from '../../_shared/ComingSoon';
import { HrPageHead } from '../HrBits';

/**
 * HR → Attendance.
 *
 * Zoho People's attendance API is a SEPARATE endpoint from the employee form used elsewhere in this
 * module, and it has not been inspected yet — so there is no confirmed column contract to build
 * against, and nothing is guessed at here.
 */
export function HrAttendance() {
  return (
    <div className="hr-page">
      <HrPageHead tab="attendance" />
      <ComingSoon
        icon={<CalendarClock size={26} />}
        title="Attendance"
        body="Check-ins, hours worked and absence per employee and per day. Zoho People exposes attendance on its own endpoint, which still needs inspecting before the columns here can be settled."
        sources={['Zoho People · attendance']}
        tone="var(--tone-emerald)"
      />
    </div>
  );
}
