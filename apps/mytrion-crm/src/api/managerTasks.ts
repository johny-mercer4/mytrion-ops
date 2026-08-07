/** Manager department Tasks API (Sales, CS, Billing, …). */
import { request } from './transport';
import type {
  TaskTypeDto,
  TaskWriteInput,
  WorkerTaskDto,
  WorkerTaskEventDto,
  WorkerTaskPriority,
  WorkerTaskStatus,
} from './salesKpi';

export type ManagerTaskDepartment =
  | 'sales'
  | 'customer-service'
  | 'billing'
  | 'finance'
  | 'collection'
  | 'mobile'
  | 'verification';

export interface ManagerAssigneeDto {
  zohoUserId: string;
  displayName: string | null;
  email: string | null;
  currentProfileName: string | null;
  currentRoleName: string | null;
}

function deptPath(department: ManagerTaskDepartment): string {
  return encodeURIComponent(department);
}

export async function listManagerAssignees(
  department: ManagerTaskDepartment,
): Promise<ManagerAssigneeDto[]> {
  const data = (await request('GET', `/manager/${deptPath(department)}/workers`)) as {
    workers: ManagerAssigneeDto[];
  };
  return data.workers;
}

/** Types this desk may use: its own, plus the shared (`department: null`) ones. */
export async function listManagerDeptTaskTypes(
  department: ManagerTaskDepartment,
): Promise<TaskTypeDto[]> {
  const data = (await request('GET', `/manager/${deptPath(department)}/tasks/types`)) as {
    types: TaskTypeDto[];
  };
  return data.types;
}

export interface ManagerTaskCounts {
  open: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

/** Open + in-progress load per assignee on this desk, with how much of it is past its deadline. */
export interface ManagerAssigneeLoad {
  assigneeZohoUserId: string;
  open: number;
  overdue: number;
}

export interface ManagerTaskPage {
  tasks: WorkerTaskDto[];
  /**
   * Status totals for the WHOLE desk — they deliberately ignore the status/priority/search filter,
   * because these are the numbers you read to decide what to filter by.
   */
  counts: ManagerTaskCounts;
  load: ManagerAssigneeLoad[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface ManagerTaskFilter {
  assigneeZohoUserId?: string;
  status?: WorkerTaskStatus;
  priority?: WorkerTaskPriority;
  /** Free text over subject / description / type. */
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listManagerDeptTasks(
  department: ManagerTaskDepartment,
  filter: ManagerTaskFilter = {},
): Promise<ManagerTaskPage> {
  // Spread into a plain record: `request`'s query param is an index signature, and an interface
  // (unlike a type alias) has no implicit one.
  const query: Record<string, string | number | undefined> = { ...filter };
  return (await request('GET', `/manager/${deptPath(department)}/tasks`, {
    query,
  })) as ManagerTaskPage;
}

export async function createManagerDeptTask(
  department: ManagerTaskDepartment,
  body: TaskWriteInput,
): Promise<WorkerTaskDto> {
  const data = (await request('POST', `/manager/${deptPath(department)}/tasks`, { body })) as {
    task: WorkerTaskDto;
  };
  return data.task;
}

export async function updateManagerDeptTask(
  department: ManagerTaskDepartment,
  taskId: string,
  body: { version: number } & Partial<TaskWriteInput> & {
      status?: WorkerTaskStatus;
      comment?: string;
      priority?: WorkerTaskPriority;
    },
): Promise<WorkerTaskDto> {
  const data = (await request(
    'PATCH',
    `/manager/${deptPath(department)}/tasks/${encodeURIComponent(taskId)}`,
    { body },
  )) as { task: WorkerTaskDto };
  return data.task;
}

export async function listManagerDeptTaskEvents(
  department: ManagerTaskDepartment,
  taskId: string,
): Promise<WorkerTaskEventDto[]> {
  const data = (await request(
    'GET',
    `/manager/${deptPath(department)}/tasks/${encodeURIComponent(taskId)}/events`,
  )) as { events: WorkerTaskEventDto[] };
  return data.events;
}
