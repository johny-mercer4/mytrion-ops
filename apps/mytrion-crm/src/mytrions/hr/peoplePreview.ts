/**
 * HR Mytrion — Zoho People field map + PLACEHOLDER preview rows.
 *
 * ⚠️ NOTHING IN THIS FILE IS REAL EMPLOYEE DATA. The HR module is UI/UX scaffolding: no tab calls
 * Zoho People yet. The rows below are synthetic and exist only so the layouts can be designed and
 * reviewed against realistic shapes. Every tab renders `<PreviewBanner />` saying exactly that.
 * Delete `PREVIEW_*` wholesale when the real fetch lands — do not "fix up" these rows into a seed.
 *
 * ── What IS real: the field map ──────────────────────────────────────────────────────────────
 * Captured from a live `searchEmployees()` call against Zoho People on 2026-07-27 (100-record
 * sample). Field coverage across that sample, which is what shaped the columns below:
 *
 *   100%  EmailID · FirstName · LastName · EmployeeID (HRM###) · Employeestatus · Role
 *         Photo / Photo_downloadUrl · ZUID · Zoho_ID · Experience · Age · CreatedTime/ModifiedTime
 *    73%  Reporting_To (+ .ID, .MailID) · Full_Name
 *    72%  Department (+ .ID)          70%  Designation (+ .ID)
 *    66%  LocationName (+ .ID)        65%  Dateofjoining
 *    49%  Date_of_birth               48%  Mobile (+ .country_code)
 *    42%  Second_Reporting_To          31%  Face_ID
 *    ~1%  Work_phone · Expertise · Present_Address · Permanent_Address
 *
 * Consequences for the UI, already applied here:
 *   • Build the display name from FirstName + LastName. `Full_Name` is only 73% populated.
 *   • Department / Designation / Location must all render an explicit empty state — roughly a third
 *     of records have none.
 *   • `Employeestatus` is the status source of truth: Active / Terminated (60/40 in the sample).
 *   • `tabularSections` (Education Details / Work experience / Dependent Details) is a nested object,
 *     not a scalar — it needs its own sub-view, not a table column.
 *
 * Open question for the fetch work: the call returned exactly 100 rows for `limit: 200`, so either
 * the org has 100 employees or the People API/wrapper caps a page at 100. Confirm before assuming
 * the directory is complete — pagination may be required.
 */

/** Real `Department` values seen in Zoho People (the categories, not any person). */
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

/** A directory row as the UI will consume it once Zoho People is wired. */
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

/** SYNTHETIC placeholder rows. Not real people. See the file header. */
export const PREVIEW_EMPLOYEES: HrEmployeeVM[] = [
  { recordId: 'preview-1', employeeId: 'HRM101', firstName: 'Placeholder', lastName: 'Record One', email: 'sample.one@example.invalid', department: 'Uzbekistan Sales Team', designation: 'Lead Generator', location: 'Tashkent', status: 'Active', role: 'Team member', joined: '2025-02-11' },
  { recordId: 'preview-2', employeeId: 'HRM102', firstName: 'Placeholder', lastName: 'Record Two', email: 'sample.two@example.invalid', department: 'Canada Sales Team', designation: 'Deal Closer', location: 'Toronto', status: 'Active', role: 'Representative', joined: '2024-09-03' },
  { recordId: 'preview-3', employeeId: 'HRM103', firstName: 'Placeholder', lastName: 'Record Three', email: 'sample.three@example.invalid', department: 'Customer Experience', designation: 'Customer Experience Agent', location: '', status: 'Active', role: 'Team member', joined: '2025-06-20' },
  { recordId: 'preview-4', employeeId: 'HRM104', firstName: 'Placeholder', lastName: 'Record Four', email: 'sample.four@example.invalid', department: 'Finance', designation: 'Finance Specialist', location: 'Tashkent', status: 'Terminated', role: 'Team member', joined: '2024-01-15' },
  { recordId: 'preview-5', employeeId: 'HRM105', firstName: 'Placeholder', lastName: 'Record Five', email: 'sample.five@example.invalid', department: '', designation: '', location: '', status: 'Active', role: 'Representative', joined: '' },
  { recordId: 'preview-6', employeeId: 'HRM106', firstName: 'Placeholder', lastName: 'Record Six', email: 'sample.six@example.invalid', department: 'Risk & Compliance', designation: 'Risk & Compliance Manager', location: 'Tashkent', status: 'Active', role: 'Manager', joined: '2023-11-02' },
];

/** SYNTHETIC attendance rows. */
export interface HrAttendanceVM {
  employee: string;
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  hours: string;
  state: 'Present' | 'Late' | 'Absent' | 'Leave';
}

export const PREVIEW_ATTENDANCE: HrAttendanceVM[] = [
  { employee: 'Placeholder Record One', employeeId: 'HRM101', date: '2026-07-27', checkIn: '09:02', checkOut: '18:10', hours: '9h 08m', state: 'Present' },
  { employee: 'Placeholder Record Two', employeeId: 'HRM102', date: '2026-07-27', checkIn: '09:41', checkOut: '18:05', hours: '8h 24m', state: 'Late' },
  { employee: 'Placeholder Record Three', employeeId: 'HRM103', date: '2026-07-27', checkIn: '—', checkOut: '—', hours: '—', state: 'Leave' },
  { employee: 'Placeholder Record Six', employeeId: 'HRM106', date: '2026-07-27', checkIn: '08:55', checkOut: '17:48', hours: '8h 53m', state: 'Present' },
  { employee: 'Placeholder Record Five', employeeId: 'HRM105', date: '2026-07-27', checkIn: '—', checkOut: '—', hours: '—', state: 'Absent' },
];

/** SYNTHETIC request rows. */
export interface HrRequestVM {
  id: string;
  employee: string;
  kind: 'Annual leave' | 'Sick leave' | 'Unpaid leave' | 'Remote work' | 'Expense';
  range: string;
  submitted: string;
  status: 'Pending' | 'Approved' | 'Rejected';
}

export const PREVIEW_REQUESTS: HrRequestVM[] = [
  { id: 'preview-r1', employee: 'Placeholder Record One', kind: 'Annual leave', range: '04 Aug — 08 Aug (5d)', submitted: '2026-07-24', status: 'Pending' },
  { id: 'preview-r2', employee: 'Placeholder Record Three', kind: 'Sick leave', range: '27 Jul (1d)', submitted: '2026-07-27', status: 'Pending' },
  { id: 'preview-r3', employee: 'Placeholder Record Two', kind: 'Remote work', range: '29 Jul — 30 Jul (2d)', submitted: '2026-07-22', status: 'Approved' },
  { id: 'preview-r4', employee: 'Placeholder Record Six', kind: 'Expense', range: 'Travel · $420.00', submitted: '2026-07-19', status: 'Approved' },
  { id: 'preview-r5', employee: 'Placeholder Record Five', kind: 'Unpaid leave', range: '12 Aug — 23 Aug (10d)', submitted: '2026-07-18', status: 'Rejected' },
];

/** Initials for the avatar chip. Falls back to '—' so a nameless record still renders. */
export function initials(first: string, last: string): string {
  const a = first.trim().charAt(0);
  const b = last.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || '—';
}

/** Display name, built from FirstName + LastName (see the header — Full_Name is unreliable). */
export function fullName(e: Pick<HrEmployeeVM, 'firstName' | 'lastName'>): string {
  return `${e.firstName} ${e.lastName}`.trim() || '(unnamed)';
}

/** Value, or the em-dash placeholder Zoho People's sparse fields need. */
export const orDash = (v: string): string => (v.trim() ? v : '—');
