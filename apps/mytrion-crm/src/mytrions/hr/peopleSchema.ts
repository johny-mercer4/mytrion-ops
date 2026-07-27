/**
 * HR Mytrion — the Zoho People field map.
 *
 * NO DATA LIVES HERE. This file records what the People API actually returns, captured from a live
 * `searchEmployees()` call on 2026-07-27 (100-record sample), so the tabs can be wired without
 * re-discovering the shape. The placeholder employee/attendance/request rows that used to sit
 * alongside it were deleted: a fabricated employee row is indistinguishable from a real one at a
 * glance, and the tabs now render an explicit Coming soon instead.
 *
 * ── Field coverage across the sample ─────────────────────────────────────────────────────────
 *   100%  EmailID · FirstName · LastName · EmployeeID (HRM###) · Employeestatus · Role
 *         Photo / Photo_downloadUrl · ZUID · Zoho_ID · Experience · Age · CreatedTime/ModifiedTime
 *    73%  Reporting_To (+ .ID, .MailID) · Full_Name
 *    72%  Department (+ .ID)          70%  Designation (+ .ID)
 *    66%  LocationName (+ .ID)        65%  Dateofjoining
 *    49%  Date_of_birth               48%  Mobile (+ .country_code)
 *    42%  Second_Reporting_To          31%  Face_ID
 *    ~1%  Work_phone · Expertise · Present_Address · Permanent_Address
 *
 * ── Consequences for whoever builds the tabs ─────────────────────────────────────────────────
 *   • Compose the display name from FirstName + LastName — `Full_Name` is only 73% populated.
 *   • Department / Designation / Location need real empty states; ~a third of records have none.
 *   • `Employeestatus` is the status source of truth: Active / Terminated (60/40 in the sample).
 *   • `tabularSections` (Education Details / Work experience / Dependent Details) is a NESTED
 *     object, not a scalar — it needs its own sub-view, never a table column.
 *   • ⚠️ The call returned exactly 100 rows for `limit: 200`. Either the org has 100 employees or
 *     the wrapper/API caps a page at 100 — confirm before assuming the directory is complete.
 *
 * Attendance and leave/requests live on SEPARATE Zoho People endpoints that have NOT been
 * inspected yet; do not assume they mirror the employee form.
 */

/** Real `Department` values observed in Zoho People — categories, not people. */
export const PEOPLE_DEPARTMENTS = [
  'Uzbekistan Sales Team',
  'Canada Sales Team',
  'Customer Experience',
  'Sales',
  'Research & Development (Zoho)',
  'Finance',
  'Risk & Compliance',
  'Analytics',
  'Billing & Accounting',
  'IT',
  'Customer Retention',
  'Business Development',
] as const;

/** Real `Employeestatus` values. */
export type EmployeeStatus = 'Active' | 'Terminated';

/** The directory row shape the Employees tab will consume once Zoho People is wired. */
export interface HrEmployeeVM {
  recordId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  /** '' when Zoho People has none — ~28% of records. */
  department: string;
  designation: string;
  location: string;
  status: EmployeeStatus;
  role: string;
  /** '' when unset — ~35% of records. */
  joined: string;
}
