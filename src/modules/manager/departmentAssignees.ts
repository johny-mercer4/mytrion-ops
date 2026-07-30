/**
 * Resolve who a Manager can assign Tasks to for a given department desk.
 * Sales keeps the KPI-eligible roster; other desks use Zoho users who can enter that Mytrion.
 */
import { listActiveUsersCached } from '../auth/actAsDirectory.js';
import { mytrionAccessService } from '../access/mytrionAccessService.js';
import { isMytrionId, type MytrionId } from '../../lib/mytrions.js';
import { kpiWorkerRepo } from '../../repos/kpiWorkerRepo.js';
import { workerMytrionAccessRepo } from '../../repos/workerMytrionAccessRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export const MANAGER_TASK_DEPARTMENTS = [
  'sales',
  'customer-service',
  'billing',
  'finance',
  'collection',
  'mobile',
  'verification',
] as const;

export type ManagerTaskDepartment = (typeof MANAGER_TASK_DEPARTMENTS)[number];

export function isManagerTaskDepartment(value: string): value is ManagerTaskDepartment {
  return (MANAGER_TASK_DEPARTMENTS as readonly string[]).includes(value);
}

/** Map Manager desk → Mytrion used for assignee filtering (`mobile` has no dedicated Mytrion). */
const DEPT_TO_MYTRION: Record<ManagerTaskDepartment, MytrionId | null> = {
  sales: 'sales',
  'customer-service': 'customer-service',
  billing: 'billing',
  finance: 'finance',
  collection: 'collection',
  mobile: null,
  verification: 'verification',
};

export interface ManagerAssigneeDto {
  zohoUserId: string;
  displayName: string | null;
  email: string | null;
  currentProfileName: string | null;
  currentRoleName: string | null;
}

export async function listDepartmentAssignees(
  ctx: TenantContext,
  department: ManagerTaskDepartment,
): Promise<ManagerAssigneeDto[]> {
  if (department === 'sales') {
    const workers = await kpiWorkerRepo.list(ctx, true);
    return workers.map((w) => ({
      zohoUserId: w.zohoUserId,
      displayName: w.displayName,
      email: w.email,
      currentProfileName: w.currentProfileName,
      currentRoleName: w.currentRoleName,
    }));
  }

  const mytrion = DEPT_TO_MYTRION[department];
  const [users, overrides] = await Promise.all([
    listActiveUsersCached(),
    workerMytrionAccessRepo.list(ctx),
  ]);
  const effective = await mytrionAccessService.resolveBatch(
    ctx.tenantId,
    users.map((u) => ({
      tenantId: ctx.tenantId,
      zohoUserId: u.zohoUserId,
      profileName: u.profile,
      zohoRole: u.role,
      userName: u.name,
    })),
    overrides,
  );

  const out: ManagerAssigneeDto[] = [];
  for (const u of users) {
    const access = effective.get(u.zohoUserId);
    if (!access) continue;
    const allowed = access.accessibleMytrions ?? [];
    let include = false;
    if (mytrion && isMytrionId(mytrion)) {
      include = access.allDepartmentAccess || allowed.includes(mytrion);
    } else {
      const hay = `${u.profile ?? ''} ${u.role ?? ''} ${u.name ?? ''}`.toLowerCase();
      include = hay.includes('mobile');
    }
    if (!include) continue;
    out.push({
      zohoUserId: u.zohoUserId,
      displayName: u.name,
      email: u.email,
      currentProfileName: u.profile,
      currentRoleName: u.role,
    });
  }

  out.sort((a, b) => (a.displayName ?? a.zohoUserId).localeCompare(b.displayName ?? b.zohoUserId));
  return out;
}

export async function assertDepartmentAssignee(
  ctx: TenantContext,
  department: ManagerTaskDepartment,
  assigneeZohoUserId: string,
): Promise<void> {
  if (department === 'sales') {
    const worker = await kpiWorkerRepo.findByZohoUserId(ctx, assigneeZohoUserId);
    if (!worker || !(await kpiWorkerRepo.isCurrentlyEligible(ctx, worker.id))) {
      throw new Error('NOT_FOUND_ASSIGNEE');
    }
    return;
  }
  const roster = await listDepartmentAssignees(ctx, department);
  if (!roster.some((w) => w.zohoUserId === assigneeZohoUserId)) {
    throw new Error('NOT_FOUND_ASSIGNEE');
  }
}
