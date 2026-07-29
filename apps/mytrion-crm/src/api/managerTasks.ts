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

export async function listManagerDeptTaskTypes(
  department: ManagerTaskDepartment,
): Promise<TaskTypeDto[]> {
  const data = (await request('GET', `/manager/${deptPath(department)}/tasks/types`)) as {
    types: TaskTypeDto[];
  };
  return data.types;
}

export async function listManagerDeptTasks(
  department: ManagerTaskDepartment,
  filter: { assigneeZohoUserId?: string; status?: WorkerTaskStatus } = {},
): Promise<WorkerTaskDto[]> {
  const data = (await request('GET', `/manager/${deptPath(department)}/tasks`, {
    query: filter,
  })) as { tasks: WorkerTaskDto[] };
  return data.tasks;
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
