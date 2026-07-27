/** Sales KPI collection and worker-task API. Ratings intentionally do not exist in this contract. */
import { request } from './transport';

export type WorkerTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type WorkerTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

export interface KpiWorkerDto {
  id: string;
  zohoUserId: string;
  displayName: string | null;
  email: string | null;
  currentProfileName: string | null;
  currentRoleName: string | null;
  sourceActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerTaskDto {
  id: string;
  assigneeZohoUserId: string;
  createdByUserId: string;
  source: 'manager' | 'webhook';
  externalId: string | null;
  taskType: string;
  subject: string;
  description: string | null;
  content: Record<string, unknown> | null;
  priority: WorkerTaskPriority;
  status: WorkerTaskStatus;
  deadlineAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerTaskEventDto {
  id: string;
  taskId: string;
  eventType: string;
  actorUserId: string;
  fromStatus: WorkerTaskStatus | null;
  toStatus: WorkerTaskStatus | null;
  detail: Record<string, unknown> | null;
  occurredAt: string;
}

export interface TaskTypeDto {
  id: string;
  code: string;
  label: string;
  active: boolean;
}

export interface KpiIngestionRunDto {
  id: string;
  source: string;
  mode: string;
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
  recordsSeen: number;
  recordsWritten: number;
  unresolvedMappings: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface TaskWriteInput {
  assigneeZohoUserId: string;
  type: string;
  subject: string;
  description?: string;
  deadlineAt?: string;
  priority?: WorkerTaskPriority;
}

export async function listKpiWorkers(): Promise<KpiWorkerDto[]> {
  const data = (await request('GET', '/manager/sales/kpi/workers')) as { workers: KpiWorkerDto[] };
  return data.workers;
}

export async function getKpiCollectionHealth(): Promise<{
  enabled: boolean;
  reportingTimezone: string;
  ingestionRuns: KpiIngestionRunDto[];
}> {
  return (await request('GET', '/manager/sales/kpi/collection-health')) as {
    enabled: boolean;
    reportingTimezone: string;
    ingestionRuns: KpiIngestionRunDto[];
  };
}

export async function listManagerTasks(filter: {
  assigneeZohoUserId?: string;
  status?: WorkerTaskStatus;
} = {}): Promise<WorkerTaskDto[]> {
  const data = (await request('GET', '/manager/sales/tasks', { query: filter })) as {
    tasks: WorkerTaskDto[];
  };
  return data.tasks;
}

export async function listTaskTypes(): Promise<TaskTypeDto[]> {
  const data = (await request('GET', '/manager/sales/tasks/types')) as { types: TaskTypeDto[] };
  return data.types;
}

export async function createManagerTask(body: TaskWriteInput): Promise<WorkerTaskDto> {
  const data = (await request('POST', '/manager/sales/tasks', { body })) as { task: WorkerTaskDto };
  return data.task;
}

export async function updateManagerTask(
  taskId: string,
  body: { version: number } & Partial<TaskWriteInput> & {
      status?: WorkerTaskStatus;
      comment?: string;
    },
): Promise<WorkerTaskDto> {
  const data = (await request('PATCH', `/manager/sales/tasks/${encodeURIComponent(taskId)}`, {
    body,
  })) as { task: WorkerTaskDto };
  return data.task;
}

export async function listMyTasks(): Promise<WorkerTaskDto[]> {
  const data = (await request('GET', '/sales/tasks', { impersonate: false })) as {
    tasks: WorkerTaskDto[];
  };
  return data.tasks;
}

export async function listMyTaskEvents(taskId: string): Promise<WorkerTaskEventDto[]> {
  const data = (await request('GET', `/sales/tasks/${encodeURIComponent(taskId)}/events`, {
    impersonate: false,
  })) as { events: WorkerTaskEventDto[] };
  return data.events;
}

export async function moveMyTask(
  taskId: string,
  version: number,
  status: 'in_progress' | 'completed',
): Promise<WorkerTaskDto> {
  const data = (await request('PATCH', `/sales/tasks/${encodeURIComponent(taskId)}/status`, {
    body: { version, status },
    impersonate: false,
  })) as { task: WorkerTaskDto };
  return data.task;
}
