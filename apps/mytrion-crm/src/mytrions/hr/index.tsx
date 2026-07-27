import { HrShell } from './HrShell';

/**
 * HR Mytrion — people operations: Home, Employees, Attendance, Requests, Profile.
 *
 * STRUCTURAL ONLY. Nothing here reads Zoho People yet, and no tab renders invented data — the four
 * unbuilt tabs show the shared <ComingSoon /> instead. The confirmed Zoho People field map, captured
 * from a live call, is recorded in peopleSchema.ts for whoever wires them up.
 */
export default function HrMytrion() {
  return (
    <div data-mytrion="hr" className="contents">
      <HrShell />
    </div>
  );
}
