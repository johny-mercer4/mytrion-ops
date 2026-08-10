/** Mytrion HR — employee directory (`/v1/hr/employees*`). Own DB, not a live Zoho People proxy. */
import { request } from './transport';

export interface HrEmployeeDto {
  id: string;
  zohoRecordId: string | null;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  departmentId: string | null;
  department: string | null;
  departmentZohoId: string | null;
  designation: string | null;
  location: string | null;
  status: string;
  role: string | null;
  dateOfJoining: string | null;
  mobile: string | null;
  /** Zoho People `Face_ID` — biometric / access-control id (text; often zero-padded). */
  faceId: string | null;
  /** Bare Telegram handle — no '@', no t.me/ prefix. The UI renders the '@'. */
  telegramUsername: string | null;
  reportingTo: string | null;
  reportingToZohoId: string | null;
  /** The manager as a stable id — what the org canvas links on (a name cannot survive a rename). */
  reportingToEmployeeId: string | null;
  /**
   * Re-hosted avatar as a `file_assets` id — resolve it with `getHrEmployeePhotoLink`.
   *
   * NOT a URL. Zoho People's photo endpoint is OAuth-gated and 401s in an `<img>`, so the API stopped
   * sending it; `<HrAvatar>` takes this id and fetches a short-lived link only for the faces on screen.
   */
  photoFileId: string | null;
  /** Zoho CRM sign-in linked to this employee for HR RBAC. */
  zohoUserId: string | null;
  zohoUserIdSource: string | null;
  zohoUserLinkedAt: string | null;
  /** Dragged org-canvas position; null means the auto-layout owns this node. */
  canvasX: number | null;
  canvasY: number | null;
  source: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HrEmployeeWriteInput {
  employeeId?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  departmentId?: string | null;
  department?: string | null;
  designation?: string | null;
  location?: string | null;
  status?: string;
  role?: string | null;
  dateOfJoining?: string | null;
  mobile?: string | null;
  faceId?: string | null;
  reportingTo?: string | null;
  /**
   * The manager as an id — preferred over `reportingTo`. The backend resolves the display name from
   * the row, so the picker and the org canvas can never disagree about who someone reports to.
   */
  reportingToEmployeeId?: string | null;
  telegramUsername?: string | null;
}

export type HrEmployeePatchInput = Partial<HrEmployeeWriteInput>;

export interface ListHrEmployeesOpts {
  q?: string;
  status?: string;
  department?: string;
  departmentId?: string;
  designation?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface ListHrEmployeesResult {
  items: HrEmployeeDto[];
  total: number;
}

/** The signed-in worker's own linked employee row (404 when unlinked). */
export async function getHrMe(signal?: AbortSignal): Promise<HrEmployeeDto> {
  return (await request('GET', '/hr/me', {
    ...(signal ? { signal } : {}),
  })) as HrEmployeeDto;
}

export async function listHrEmployees(
  opts: ListHrEmployeesOpts = {},
): Promise<ListHrEmployeesResult> {
  const data = await request('GET', '/hr/employees', {
    query: {
      q: opts.q,
      status: opts.status,
      department: opts.department,
      departmentId: opts.departmentId,
      designation: opts.designation,
      limit: opts.limit,
      offset: opts.offset,
    },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return data as ListHrEmployeesResult;
}

export async function listHrDesignations(signal?: AbortSignal): Promise<string[]> {
  const data = await request('GET', '/hr/meta/designations', {
    ...(signal ? { signal } : {}),
  });
  return (data as { designations?: string[] }).designations ?? [];
}

export interface HrZohoUserDto {
  id: string;
  name: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
}

export async function listHrZohoUsers(signal?: AbortSignal): Promise<HrZohoUserDto[]> {
  const data = await request('GET', '/hr/zoho-users', {
    ...(signal ? { signal } : {}),
  });
  return (data as { items: HrZohoUserDto[] }).items;
}

export async function linkHrEmployeeZohoUser(
  employeeId: string,
  zohoUserId: string | null,
): Promise<HrEmployeeDto> {
  return (await request('PATCH', `/hr/employees/${encodeURIComponent(employeeId)}/zoho-user`, {
    body: { zohoUserId },
  })) as HrEmployeeDto;
}

// ── Org graph (`GET /hr/org-structure`) ─────────────────────────────────────
//
// Two flat lists, not a nested tree: the canvas needs `{id, parentId, position}` records it can lay
// out and re-parent in place, and a person who reports across departments has no single home in a
// tree. Edges are derived on the client from parentId / departmentId / reportingToEmployeeId.

export interface HrOrgDepartmentDto {
  id: string;
  name: string;
  code: string | null;
  leadName: string | null;
  parentId: string | null;
  description: string | null;
  icon: string | null;
  iconColor: string | null;
  canvasX: number | null;
  canvasY: number | null;
  employeeCount: number;
  activeEmployeeCount: number;
}

/** Narrower than `HrEmployeeDto` on purpose — the canvas draws a name, a title and a face. */
export interface HrOrgEmployeeDto {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  status: string;
  departmentId: string | null;
  reportingToEmployeeId: string | null;
  photoFileId: string | null;
  canvasX: number | null;
  canvasY: number | null;
}

export interface HrOrgStructureDto {
  departments: HrOrgDepartmentDto[];
  employees: HrOrgEmployeeDto[];
  departmentCount: number;
  employeeLinkedCount: number;
  employeeUnlinkedCount: number;
}

export async function getHrOrgStructure(signal?: AbortSignal): Promise<HrOrgStructureDto> {
  return (await request('GET', '/hr/org-structure', {
    ...(signal ? { signal } : {}),
  })) as HrOrgStructureDto;
}

export type HrOrgNodeKind = 'department' | 'employee';

/** Persist a dragged node. `position: null` hands the node back to the auto-layout. */
export async function setHrOrgPosition(
  kind: HrOrgNodeKind,
  id: string,
  position: { x: number; y: number } | null,
): Promise<void> {
  await request('PATCH', '/hr/org/position', { body: { kind, id, position } });
}

/**
 * Re-parent a node — what dropping one node onto another means. `parentId: null` detaches.
 *
 * The backend rejects cycles and department-under-person with a 400, so callers should surface the
 * error rather than assume success.
 */
export async function reparentHrOrgNode(input: {
  kind: HrOrgNodeKind;
  id: string;
  parentId: string | null;
  parentKind: HrOrgNodeKind;
}): Promise<void> {
  await request('PATCH', '/hr/org/reparent', { body: input });
}

export async function createHrEmployee(body: HrEmployeeWriteInput): Promise<HrEmployeeDto> {
  return (await request('POST', '/hr/employees', { body })) as HrEmployeeDto;
}

export async function updateHrEmployee(
  id: string,
  body: HrEmployeePatchInput,
): Promise<HrEmployeeDto> {
  return (await request('PATCH', `/hr/employees/${encodeURIComponent(id)}`, {
    body,
  })) as HrEmployeeDto;
}

export async function deleteHrEmployee(id: string): Promise<void> {
  await request('DELETE', `/hr/employees/${encodeURIComponent(id)}`);
}

export interface HrSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  relinkedManagers?: number;
  relinkedAttendancePunches?: number;
  errors: Array<{ zohoRecordId: string; message: string }>;
}

/** Admin-only Zoho People → hr_employees pull. */
export async function syncHrEmployees(opts: { maxPages?: number } = {}): Promise<HrSyncResult> {
  return (await request('POST', '/hr/employees/sync', {
    body: opts.maxPages != null ? { maxPages: opts.maxPages } : {},
  })) as HrSyncResult;
}

/** Admin-only Zoho People → hr_departments pull. */
export async function syncHrDepartments(opts: { maxPages?: number } = {}): Promise<HrSyncResult> {
  return (await request('POST', '/hr/departments/sync', {
    body: opts.maxPages != null ? { maxPages: opts.maxPages } : {},
  })) as HrSyncResult;
}

// ── Departments (`hr_departments`) ───────────────────────────────────────────

export interface HrDepartmentDto {
  id: string;
  zohoRecordId: string | null;
  name: string;
  code: string | null;
  mailAlias: string | null;
  leadName: string | null;
  leadZohoId: string | null;
  leadEmail: string | null;
  /** Stable person link — preferred over free-text `leadName` for the admin picker. */
  leadEmployeeId: string | null;
  parentName: string | null;
  parentZohoId: string | null;
  parentId: string | null;
  /** Markdown — rendered through rehype-sanitize, never injected as HTML. */
  description: string | null;
  /** A lucide component NAME, resolved through a static map (unknown → default glyph). */
  icon: string | null;
  /** A Horizon tone TOKEN name (e.g. 'tone-sky'), resolved through a static map. */
  iconColor: string | null;
  canvasX: number | null;
  canvasY: number | null;
  source: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HrDepartmentWriteInput {
  name: string;
  code?: string | null;
  mailAlias?: string | null;
  leadName?: string | null;
  leadEmployeeId?: string | null;
  parentName?: string | null;
  description?: string | null;
  icon?: string | null;
  iconColor?: string | null;
}

export type HrDepartmentPatchInput = Partial<HrDepartmentWriteInput>;

export interface ListHrDepartmentsOpts {
  q?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface ListHrDepartmentsResult {
  items: HrDepartmentDto[];
  total: number;
}

export async function listHrDepartments(
  opts: ListHrDepartmentsOpts = {},
): Promise<ListHrDepartmentsResult> {
  const data = await request('GET', '/hr/departments', {
    query: {
      q: opts.q,
      limit: opts.limit,
      offset: opts.offset,
    },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return data as ListHrDepartmentsResult;
}

export async function createHrDepartment(body: HrDepartmentWriteInput): Promise<HrDepartmentDto> {
  return (await request('POST', '/hr/departments', { body })) as HrDepartmentDto;
}

export async function updateHrDepartment(
  id: string,
  body: HrDepartmentPatchInput,
): Promise<HrDepartmentDto> {
  return (await request('PATCH', `/hr/departments/${encodeURIComponent(id)}`, {
    body,
  })) as HrDepartmentDto;
}

export async function deleteHrDepartment(id: string): Promise<void> {
  await request('DELETE', `/hr/departments/${encodeURIComponent(id)}`);
}

// ── Attendance (Mytrion-owned punches + shifts) ───────────────────────────────

export type AttendanceDayStatus = 'Present' | 'Absent' | 'Weekend' | 'Unscheduled';
export type AttendancePresenceState =
  | 'in_office'
  | 'out_of_office'
  | 'no_activity'
  | 'needs_review';

export interface AttendanceDayRow {
  date: string;
  status: AttendanceDayStatus;
  firstIn: string | null;
  lastOut: string | null;
  hoursWorked: string;
  hoursWorkedMs: number;
  punchCount: number;
  currentState: AttendancePresenceState;
  unmatchedPunches: number;
  sessions: Array<{
    checkIn: string;
    checkOut: string | null;
    checkInDoor: string | null;
    checkOutDoor: string | null;
    duration: string;
    durationMs: number;
    checkInAt: string;
    checkOutAt: string | null;
    status: 'complete' | 'open' | 'needs_review';
  }>;
}

export interface AttendanceSummaryDto {
  employeeId: string;
  from: string;
  to: string;
  calculatedAt: string;
  timezone: 'Asia/Tashkent';
  shift: {
    id: string;
    name: string;
    startLocal: string;
    endLocal: string;
    timezone: string;
  } | null;
  days: AttendanceDayRow[];
  totals: {
    payableDays: number;
    present: number;
    weekend: number;
    absent: number;
    unscheduled: number;
    onDuty: number;
    paidLeave: number;
    holidays: number;
  };
  lastPunch: {
    kind: string;
    punchedAt: string;
    localDateTime: string;
    doorName: string | null;
  } | null;
  currentState: AttendancePresenceState;
}

export interface HrAttendanceShiftDto {
  id: string;
  name: string;
  timezone: string;
  startLocal: string;
  endLocal: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HrAttendanceShiftWrite {
  name: string;
  timezone?: string | null;
  startLocal: string;
  endLocal: string;
  isActive?: boolean;
}

export async function getMyAttendance(
  opts: {
    from?: string;
    to?: string;
    weekOf?: string;
    signal?: AbortSignal;
  } = {},
): Promise<AttendanceSummaryDto> {
  return (await request('GET', '/hr/attendance/me', {
    query: {
      from: opts.from,
      to: opts.to,
      weekOf: opts.weekOf,
    },
    ...(opts.signal ? { signal: opts.signal } : {}),
  })) as AttendanceSummaryDto;
}

export async function getAttendanceSummary(opts: {
  from: string;
  to: string;
  employeeId?: string;
  signal?: AbortSignal;
}): Promise<AttendanceSummaryDto> {
  return (await request('GET', '/hr/attendance/summary', {
    query: {
      from: opts.from,
      to: opts.to,
      employeeId: opts.employeeId,
    },
    ...(opts.signal ? { signal: opts.signal } : {}),
  })) as AttendanceSummaryDto;
}

export type AttendanceTeamScope = 'direct' | 'all';
export type AttendanceTeamRelation = 'direct_report' | 'dept_member' | 'org';

export interface AttendanceTeamListItem {
  employeeId: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  designation: string | null;
  department: string | null;
  departmentId: string | null;
  photoFileId: string | null;
  relation: AttendanceTeamRelation;
  shift: AttendanceSummaryDto['shift'];
  /** Null when the roster was fetched as a directory — the detail fetch carries the week. */
  totals: {
    payableDays: number;
    present: number;
    weekend: number;
    absent: number;
    unscheduled: number;
  } | null;
  lastPunch: AttendanceSummaryDto['lastPunch'];
  currentState: AttendanceSummaryDto['currentState'];
}

export interface AttendanceTeamListDto {
  from: string;
  to: string;
  scope: AttendanceTeamScope;
  canViewAll: boolean;
  counts: { direct: number; all: number };
  unmappedPunches: number;
  items: AttendanceTeamListItem[];
}

export async function getAttendanceTeam(
  opts: {
    from?: string;
    to?: string;
    weekOf?: string;
    scope?: AttendanceTeamScope;
    q?: string;
    /** Ask for the per-person week tally. Off for the roster — it costs ~3.5s for 146 people. */
    withTotals?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<AttendanceTeamListDto> {
  return (await request('GET', '/hr/attendance/team', {
    query: {
      from: opts.from,
      to: opts.to,
      weekOf: opts.weekOf,
      scope: opts.scope,
      q: opts.q,
      ...(opts.withTotals ? {} : { totals: '0' }),
    },
    ...(opts.signal ? { signal: opts.signal } : {}),
  })) as AttendanceTeamListDto;
}

/** What one DWH refresh did. `cached` means a recent identical sync stood in for this one. */
export interface AttendanceSyncDto {
  from: string;
  to: string;
  fetched: number;
  inserted: number;
  linked: number;
  skipped: number;
  cached: boolean;
  /** The person has no Face ID on their record, so the door readers can never produce data for them. */
  noFaceId?: boolean;
}

/**
 * Pull the week's door events from the DWH before reading them.
 *
 * `retry: false` — this is a POST, so the transport would not retry it anyway, but saying so keeps the
 * intent explicit: a sync that fails is not worth a second wait, because the page renders whatever is
 * already stored regardless.
 */
export async function syncAttendanceFromDwh(opts: {
  from?: string;
  to?: string;
  weekOf?: string;
  /** Skip the server's cooldown. Set by the Refresh button, never by an automatic load. */
  force?: boolean;
  /** Pull one person's punches instead of the whole window — what opening someone in the roster does. */
  employeeId?: string;
}): Promise<AttendanceSyncDto> {
  return (await request('POST', '/hr/attendance/sync', {
    body: opts,
    /**
     * Well past the 20s default, because a COLD window legitimately needs it: the warehouse query,
     * then ~4.4k inserts, then the link and rebucket. Measured at ~1s warm, but a first-ever week (or
     * one the user scrolled back to) does real work, and timing out at 20s turned that into a warning
     * banner on a sync that was going to succeed.
     *
     * Costs nothing to wait: the page renders from cache and only re-reads if this reports new rows.
     */
    timeoutMs: 90_000,
  })) as AttendanceSyncDto;
}

export async function exportAttendanceCsv(opts: {
  from: string;
  to: string;
  employeeId: string;
}): Promise<{ csv: string; filename: string }> {
  return (await request('GET', '/hr/attendance/export', {
    query: {
      from: opts.from,
      to: opts.to,
      employeeId: opts.employeeId,
    },
  })) as { csv: string; filename: string };
}

export async function listAttendanceShifts(signal?: AbortSignal): Promise<HrAttendanceShiftDto[]> {
  const data = await request('GET', '/hr/attendance/shifts', {
    ...(signal ? { signal } : {}),
  });
  return ((data as { items?: HrAttendanceShiftDto[] }).items ?? []).filter(Boolean);
}

export async function createAttendanceShift(
  body: HrAttendanceShiftWrite,
): Promise<HrAttendanceShiftDto> {
  return (await request('POST', '/hr/attendance/shifts', { body })) as HrAttendanceShiftDto;
}

export async function updateAttendanceShift(
  id: string,
  body: Partial<HrAttendanceShiftWrite>,
): Promise<HrAttendanceShiftDto> {
  return (await request('PATCH', `/hr/attendance/shifts/${encodeURIComponent(id)}`, {
    body,
  })) as HrAttendanceShiftDto;
}

export async function deleteAttendanceShift(id: string): Promise<void> {
  await request('DELETE', `/hr/attendance/shifts/${encodeURIComponent(id)}`);
}

export async function assignAttendanceShift(
  shiftId: string,
  body: { employeeIds: string[]; effectiveFrom: string; effectiveTo?: string | null },
): Promise<{ assigned: string[] }> {
  return (await request('POST', `/hr/attendance/shifts/${encodeURIComponent(shiftId)}/assign`, {
    body,
  })) as { assigned: string[] };
}
