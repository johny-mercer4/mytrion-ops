import { request } from './transport';

export type LeaveTypeCode = 'sick' | 'annual_paid' | 'unpaid';
export type LeaveRequestStatus =
  | 'pending_lead'
  | 'pending_hr'
  | 'approved'
  | 'rejected'
  | 'cancelled';
export type LeaveDayPart = 'full' | 'morning' | 'afternoon';

export interface LeaveBalanceDto {
  leaveTypeId: string;
  code: LeaveTypeCode;
  name: string;
  isPaid: boolean;
  allocatedDays: number;
  adjustmentDays: number;
  approvedDays: number;
  pendingDays: number;
  availableDays: number;
}

export interface HolidayDto {
  id: string;
  date: string;
  name: string;
  location: string;
  isHalfDay: boolean;
  session: 'morning' | 'afternoon' | null;
  isActive: boolean;
  notes: string | null;
}

export interface LeaveTypeDto {
  id: string;
  code: LeaveTypeCode;
  name: string;
  isPaid: boolean;
  defaultDays: number;
  isActive: boolean;
  sortOrder: number;
}

export interface TimeOffOverviewDto {
  employee: {
    id: string;
    employeeNumber: string | null;
    name: string;
    department: string | null;
  };
  year: number;
  balances: LeaveBalanceDto[];
  holidays: HolidayDto[];
}

export interface LeaveRequestDto {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeNumber: string | null;
    department: string | null;
  };
  leaveTypeId: string;
  leaveTypeCode: LeaveTypeCode;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  dayPart: LeaveDayPart;
  requestedDays: number;
  reason: string | null;
  status: LeaveRequestStatus;
  currentApproverEmployeeId: string | null;
  currentApproverName: string | null;
  leadApproverEmployeeId: string | null;
  leadApproverName: string | null;
  hrApproverEmployeeId: string;
  hrApproverName: string | null;
  leadDecisionAt: string | null;
  leadComment: string | null;
  hrDecisionAt: string | null;
  hrComment: string | null;
  submittedAt: string;
  resolvedAt: string | null;
}

export interface LeaveRequestActionDto {
  id: string;
  action: 'submitted' | 'lead_approved' | 'hr_approved' | 'rejected' | 'cancelled';
  actorEmployeeId: string | null;
  actorUserId: string;
  fromStatus: LeaveRequestStatus | null;
  toStatus: LeaveRequestStatus;
  comment: string | null;
  createdAt: string;
}

export async function getTimeOffOverview(
  year: number,
  signal?: AbortSignal,
): Promise<TimeOffOverviewDto> {
  return (await request('GET', '/hr/time-off/me', {
    query: { year },
    ...(signal ? { signal } : {}),
  })) as TimeOffOverviewDto;
}

export async function listLeaveTypes(signal?: AbortSignal): Promise<LeaveTypeDto[]> {
  const data = await request('GET', '/hr/time-off/types', {
    ...(signal ? { signal } : {}),
  });
  return (data as { items: LeaveTypeDto[] }).items;
}

export async function listLeaveRequests(
  opts: {
    scope: 'mine' | 'inbox' | 'all';
    year?: number;
    status?: LeaveRequestStatus;
    q?: string;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal,
): Promise<LeaveRequestDto[]> {
  const data = await request('GET', '/hr/time-off/requests', {
    query: opts,
    ...(signal ? { signal } : {}),
  });
  return (data as { items: LeaveRequestDto[] }).items;
}

export async function getLeaveRequestDetail(
  id: string,
  signal?: AbortSignal,
): Promise<{ item: LeaveRequestDto; actions: LeaveRequestActionDto[] }> {
  return (await request('GET', `/hr/time-off/requests/${encodeURIComponent(id)}`, {
    ...(signal ? { signal } : {}),
  })) as { item: LeaveRequestDto; actions: LeaveRequestActionDto[] };
}

export async function submitLeaveRequest(body: {
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  dayPart: LeaveDayPart;
  reason?: string | null;
}): Promise<{ id: string; status: LeaveRequestStatus }> {
  return (await request('POST', '/hr/time-off/requests', { body })) as {
    id: string;
    status: LeaveRequestStatus;
  };
}

export async function decideLeaveRequest(
  id: string,
  body: { decision: 'approve' | 'reject'; comment?: string | null },
): Promise<{ id: string; status: LeaveRequestStatus }> {
  return (await request('POST', `/hr/time-off/requests/${encodeURIComponent(id)}/decision`, {
    body,
  })) as { id: string; status: LeaveRequestStatus };
}

export async function cancelLeaveRequest(id: string): Promise<void> {
  await request('POST', `/hr/time-off/requests/${encodeURIComponent(id)}/cancel`, { body: {} });
}

export interface TimeOffSettingsDto {
  settings: {
    finalApproverEmployeeId: string | null;
    finalApproverName: string | null;
    timezone: string;
  };
  types: LeaveTypeDto[];
  holidays: HolidayDto[];
  year: number;
}

export async function getTimeOffSettings(
  year: number,
  signal?: AbortSignal,
): Promise<TimeOffSettingsDto> {
  return (await request('GET', '/hr/time-off/settings', {
    query: { year },
    ...(signal ? { signal } : {}),
  })) as TimeOffSettingsDto;
}

export async function updateTimeOffSettings(body: {
  finalApproverEmployeeId?: string | null;
  timezone?: string;
}): Promise<void> {
  await request('PATCH', '/hr/time-off/settings', { body });
}

export async function updateLeaveType(
  id: string,
  body: { defaultDays?: number; name?: string; isActive?: boolean },
): Promise<LeaveTypeDto> {
  return (await request('PATCH', `/hr/time-off/types/${encodeURIComponent(id)}`, {
    body,
  })) as LeaveTypeDto;
}

export async function resetLeaveBalances(year: number): Promise<number> {
  const data = await request('POST', '/hr/time-off/balances/reset', { body: { year } });
  return (data as { updated: number }).updated;
}

export async function createHoliday(
  body: Omit<HolidayDto, 'id'>,
): Promise<HolidayDto> {
  return (await request('POST', '/hr/time-off/holidays', { body })) as HolidayDto;
}

export async function updateHoliday(
  id: string,
  body: Partial<Omit<HolidayDto, 'id'>>,
): Promise<HolidayDto> {
  return (await request('PATCH', `/hr/time-off/holidays/${encodeURIComponent(id)}`, {
    body,
  })) as HolidayDto;
}

export async function deleteHoliday(id: string): Promise<void> {
  await request('DELETE', `/hr/time-off/holidays/${encodeURIComponent(id)}`);
}
