/**
 * Shared vocabulary for the Manager Tasks board.
 *
 * The Sales agent's own board (`sales/redesign/tabs/TasksTab.tsx`) reads the SAME records from
 * `mytrion_worker_tasks`. Columns, priority order, overdue rule and the status labels are declared
 * once here so the manager who assigns a task and the agent who works it are never looking at two
 * different descriptions of one row.
 */
import type { WorkerTaskDto, WorkerTaskPriority, WorkerTaskStatus } from '../../../api/salesKpi';

export interface TaskColumn {
  id: WorkerTaskStatus;
  label: string;
  hint: string;
  /** Column accent, from the shared wayfinding scale so both themes are handled. */
  tone: string;
}

/** Left to right = the life of an assignment. Same order, same wording, as the agent board. */
export const TASK_COLUMNS: readonly TaskColumn[] = [
  { id: 'open', label: 'Open', hint: 'Not started', tone: 'var(--tone-sky)' },
  { id: 'in_progress', label: 'In progress', hint: 'Being worked', tone: 'var(--tone-amber)' },
  { id: 'completed', label: 'Completed', hint: 'Done', tone: 'var(--tone-emerald)' },
  { id: 'cancelled', label: 'Cancelled', hint: 'Stopped', tone: 'var(--tone-slate)' },
];

export const PRIORITIES: readonly WorkerTaskPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Priority hue. Normal is the module accent, not a status colour — it is the absence of a signal. */
export function priorityTone(priority: WorkerTaskPriority): string {
  if (priority === 'urgent') return 'var(--danger)';
  if (priority === 'high') return 'var(--warning)';
  if (priority === 'low') return 'var(--text-muted)';
  return 'var(--accent)';
}

export function statusLabel(status: WorkerTaskStatus): string {
  return TASK_COLUMNS.find((column) => column.id === status)?.label ?? friendly(status);
}

/** `in_progress` → `in progress`, `status_changed` → `status changed`. */
export function friendly(value: string): string {
  return value.replaceAll('_', ' ');
}

/**
 * Overdue means "past its deadline AND still someone's problem". A completed task that was finished
 * late is history, not a thing to chase, so it must not keep counting against the desk.
 */
export function isOverdue(task: WorkerTaskDto, now: number = Date.now()): boolean {
  if (!task.deadlineAt) return false;
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.deadlineAt).getTime() < now;
}

export function deadlineLabel(value: string | null): string {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function timestampLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

/**
 * `<input type="datetime-local">` speaks local wall-clock with no zone; the API wants an offset
 * ISO string. `new Date(localValue)` parses it in the browser's zone, which is what the person
 * typing it meant, and `toISOString()` then carries the correct instant.
 */
export function deadlineToIso(localValue: string): string | undefined {
  if (!localValue) return undefined;
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** Group a page of tasks into board columns, preserving the server's newest-first order. */
export function groupByStatus(tasks: readonly WorkerTaskDto[]): Record<WorkerTaskStatus, WorkerTaskDto[]> {
  const board: Record<WorkerTaskStatus, WorkerTaskDto[]> = {
    open: [],
    in_progress: [],
    completed: [],
    cancelled: [],
  };
  for (const task of tasks) board[task.status].push(task);
  return board;
}
