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

/*
 * `listManagerTasks` / `listTaskTypes` / `createManagerTask` / `updateManagerTask` lived here and
 * called `/manager/sales/tasks*`. They had no callers, and the routes behind them were duplicates
 * that shadowed the generic per-department ones. Manager task CRUD is `api/managerTasks.ts` for
 * EVERY desk, Sales included.
 */

export interface WorkerTaskCounts {
  open: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}

export interface WorkerTaskPage {
  tasks: WorkerTaskDto[];
  counts: WorkerTaskCounts;
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
}

export async function listMyTasksPage(input: { limit?: number; offset?: number } = {}): Promise<WorkerTaskPage> {
  return (await request('GET', '/sales/tasks', {
    query: { limit: input.limit ?? 50, offset: input.offset ?? 0 },
  })) as WorkerTaskPage;
}

export async function listMyTasks(): Promise<WorkerTaskDto[]> {
  const data = (await request('GET', '/sales/tasks', { query: { limit: 50, offset: 0 } })) as {
    tasks: WorkerTaskDto[];
  };
  return data.tasks;
}

export async function getMyTaskSummary(): Promise<{ counts: WorkerTaskCounts; total: number }> {
  return (await request('GET', '/sales/tasks/summary')) as {
    counts: WorkerTaskCounts;
    total: number;
  };
}

export async function listMyTaskEvents(taskId: string): Promise<WorkerTaskEventDto[]> {
  const data = (await request('GET', `/sales/tasks/${encodeURIComponent(taskId)}/events`, {
  })) as { events: WorkerTaskEventDto[] };
  return data.events;
}

export async function moveMyTask(
  taskId: string,
  version: number,
  status: WorkerTaskStatus,
): Promise<WorkerTaskDto> {
  const data = (await request('PATCH', `/sales/tasks/${encodeURIComponent(taskId)}/status`, {
    body: { version, status },
  })) as { task: WorkerTaskDto };
  return data.task;
}
