/**
 * Mytrion HR — calls scoped to ONE person: their avatar bytes and the overview panel.
 *
 * Split from `hr.ts` to keep both files inside the repo's 600-line cap.
 */
import type { AttendanceSummaryDto, HrEmployeeDto } from './hr';
import { request } from './transport';

export interface HrPhotoLink {
  url: string;
  /** ISO. Dropbox owns this (~4h) — it is not a TTL we asked for, so it must be read, not assumed. */
  expiresAt: string;
}

/**
 * Set the employee's avatar from a client-resized data URL (admin only).
 *
 * Resizing happens in the browser (`resizeImageToDataUrl`) so a 6MB phone photo never crosses the wire:
 * the API caps the encoded string, and an unresized upload would simply be rejected.
 */
export async function setHrEmployeePhoto(id: string, dataUrl: string): Promise<HrEmployeeDto> {
  return (await request('POST', `/hr/employees/${encodeURIComponent(id)}/photo`, {
    body: { dataUrl },
  })) as HrEmployeeDto;
}

export async function clearHrEmployeePhoto(id: string): Promise<HrEmployeeDto> {
  return (await request(
    'DELETE',
    `/hr/employees/${encodeURIComponent(id)}/photo`,
  )) as HrEmployeeDto;
}

/** A short-lived URL for one employee's avatar. 404s when they have none. */
export async function getHrEmployeePhotoLink(
  id: string,
  signal?: AbortSignal,
): Promise<HrPhotoLink> {
  return (await request('GET', `/hr/employees/${encodeURIComponent(id)}/photo-link`, {
    ...(signal ? { signal } : {}),
  })) as HrPhotoLink;
}

/** Zoho CRM sign-in → employee row. 404 when that sign-in has no linked employee. */
export async function getHrEmployeeByZohoUser(
  zohoUserId: string,
  signal?: AbortSignal,
): Promise<HrEmployeeDto> {
  return (await request('GET', `/hr/employees/by-zoho-user/${encodeURIComponent(zohoUserId)}`, {
    ...(signal ? { signal } : {}),
  })) as HrEmployeeDto;
}

export interface HrPersonTeamMember {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  department: string | null;
  status: string;
  photoFileId: string | null;
  relation: 'direct_report' | 'department_member';
}

export interface HrPersonLeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  allocatedDays: number;
  adjustmentDays: number;
  approvedDays: number;
  pendingDays: number;
  availableDays: number;
}

export interface HrPersonLeaveRequest {
  id: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  requestedDays: number;
  status: string;
  reason: string | null;
  submittedAt: string;
}

export interface HrPersonOverviewDto {
  employee: HrEmployeeDto;
  department: {
    id: string;
    name: string;
    code: string | null;
    leadName: string | null;
    parentName: string | null;
    icon: string | null;
    iconColor: string | null;
    headcount: number;
  } | null;
  manager: { id: string; name: string; designation: string | null } | null;
  team: {
    members: HrPersonTeamMember[];
    directReportCount: number;
    ledDepartments: { id: string; name: string }[];
  };
  attendance: {
    from: string;
    to: string;
    /** Null when the signed-in viewer may not see this person's attendance. */
    summary: AttendanceSummaryDto | null;
    canView: boolean;
  };
  timeOff: {
    year: number;
    balances: HrPersonLeaveBalance[];
    requests: HrPersonLeaveRequest[];
  };
}

/** Department, team, attendance week and time off for one employee, in a single round trip. */
export async function getHrPersonOverview(
  employeeId: string,
  opts: { year?: number; weekOf?: string; signal?: AbortSignal } = {},
): Promise<HrPersonOverviewDto> {
  return (await request('GET', `/hr/employees/${encodeURIComponent(employeeId)}/overview`, {
    query: { year: opts.year, weekOf: opts.weekOf },
    ...(opts.signal ? { signal: opts.signal } : {}),
  })) as HrPersonOverviewDto;
}
