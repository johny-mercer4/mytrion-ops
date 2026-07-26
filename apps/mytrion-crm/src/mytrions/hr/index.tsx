import { HrShell } from './HrShell';

/**
 * HR Mytrion — people operations: Home, Employees, Attendance, Requests, Profile.
 *
 * STRUCTURAL ONLY. Every tab is finished UI with placeholder records; nothing reads Zoho People yet
 * (see peoplePreview.ts for the live field map the layouts were designed against). Each tab carries
 * a visible preview banner so the placeholders can never be mistaken for real employee data.
 */
export default function HrMytrion() {
  return (
    <div data-mytrion="hr" className="contents">
      <HrShell />
    </div>
  );
}
