/**
 * Sales My Tasks — status kanban (Open → In progress → Completed → Cancelled).
 * Cards drag between columns to PATCH `/sales/tasks/:id/status`; click opens detail modal.
 * Board chrome is the shared Retention board (`.ss-ret-*`); page chrome is the shared
 * `SalesPage`/`SalesPageHead` — the tab no longer prints its own "My Tasks" heading, which the
 * top bar already shows.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import {
  listMyTasksPage,
  moveMyTask,
  type WorkerTaskCounts,
  type WorkerTaskDto,
  type WorkerTaskPage,
  type WorkerTaskStatus,
} from '@/api/salesKpi';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { invalidateDcCache, useCachedLoad, writeDcCache } from '../dcCache';
import { TaskDetailModal } from '../TaskDetailModal';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { markTaskOpened, useTaskOpened } from '../taskOpened';
import { tasksBadgeCacheKey } from '../tasksLiveBus';
import { NAV_DESC } from '../salesData';
import {
  SalesEmpty,
  SalesErrorNote,
  SalesPage,
  SalesPageHead,
  SalesPager,
  type SalesMetric,
} from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
import { emitKpiActivity } from '../kpiTelemetry';

const COLUMNS: Array<{
  id: WorkerTaskStatus;
  label: string;
  hint: string;
  color: string;
}> = [
  { id: 'open', label: 'Open', hint: 'Not started', color: 'var(--accent)' },
  { id: 'in_progress', label: 'In progress', hint: 'Actively working', color: 'var(--warn)' },
  { id: 'completed', label: 'Completed', hint: 'Done', color: 'var(--ok)' },
  { id: 'cancelled', label: 'Cancelled', hint: 'Stopped', color: 'var(--muted)' },
];

const MIME = 'application/x-mytrion-task-id';
const PAGE_SIZE = 50;

function deadlineLabel(value: string | null): string {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function isOverdue(task: WorkerTaskDto): boolean {
  if (!task.deadlineAt) return false;
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.deadlineAt).getTime() < Date.now();
}

function priorityTone(priority: WorkerTaskDto['priority']): string {
  if (priority === 'urgent') return 'var(--danger)';
  if (priority === 'high') return 'var(--warn)';
  if (priority === 'low') return 'var(--muted)';
  return 'var(--accent)';
}

export function TasksTab() {
  const { pushToast } = useSales();
  const { actingAs } = useImpersonation();
  const currentUserId = String(actingAs?.zohoUserId ?? getSession()?.worker.zohoUserId ?? '');
  const openedSet = useTaskOpened();
  const [page, setPage] = useState(1);
  const cacheKey = `sales:tasks:page:${currentUserId}:${page}:${PAGE_SIZE}`;
  const tasksLoad = useCachedLoad(
    cacheKey,
    () => listMyTasksPage({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    { staleMs: 60_000 },
  );
  const tasks = tasksLoad.data?.tasks ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<WorkerTaskStatus | null>(null);

  const syncCache = useCallback(
    (value: WorkerTaskPage) => {
      writeDcCache(cacheKey, value);
    },
    [cacheKey],
  );

  const selected = tasks.find((task) => task.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    emitKpiActivity('ui.record_open', { entityType: 'task', entityId: selectedId });
    markTaskOpened(selectedId);
  }, [selectedId]);

  const byStatus = useMemo(() => {
    const map: Record<WorkerTaskStatus, WorkerTaskDto[]> = {
      open: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    };
    for (const task of tasks) map[task.status].push(task);
    return map;
  }, [tasks]);

  const overdueCount = tasks.filter(isOverdue).length;
  const newCount = byStatus.open.filter((task) => !openedSet[task.id]).length;
  const counts = tasksLoad.data?.counts ?? {
    open: byStatus.open.length,
    in_progress: byStatus.in_progress.length,
    completed: byStatus.completed.length,
    cancelled: byStatus.cancelled.length,
  };
  const total = tasksLoad.data?.pagination.total ?? tasks.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const move = async (task: WorkerTaskDto, status: WorkerTaskStatus): Promise<void> => {
    if (task.status === status) return;
    const previous = tasksLoad.data;
    if (!previous) return;
    setMoving(true);
    const optimistic = tasks.map((row) =>
      row.id === task.id ? { ...row, status, version: row.version + 1 } : row,
    );
    const optimisticCounts: WorkerTaskCounts = {
      ...previous.counts,
      [task.status]: Math.max(0, previous.counts[task.status] - 1),
      [status]: previous.counts[status] + 1,
    };
    syncCache({ ...previous, tasks: optimistic, counts: optimisticCounts });
    try {
      const updated = await moveMyTask(task.id, task.version, status);
      const next = optimistic.map((row) => (row.id === updated.id ? updated : row));
      syncCache({ ...previous, tasks: next, counts: optimisticCounts });
      invalidateDcCache(tasksBadgeCacheKey(currentUserId));
      pushToast('Task updated', `${updated.subject} → ${status.replace('_', ' ')}`);
    } catch (error) {
      syncCache(previous);
      pushToast('Task not updated', error instanceof Error ? error.message : 'Refresh and try again.');
      await tasksLoad.reload();
    } finally {
      setMoving(false);
    }
  };

  const onCardDragStart = (taskId: string, event: DragEvent) => {
    event.dataTransfer.setData(MIME, taskId);
    event.dataTransfer.setData('text/plain', taskId);
    event.dataTransfer.effectAllowed = 'move';
    setDragId(taskId);
  };

  const onCardDragEnd = () => {
    setDragId(null);
    setOverCol(null);
  };

  const onColumnDragOver = (status: WorkerTaskStatus, event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (overCol !== status) setOverCol(status);
  };

  const onColumnDrop = (status: WorkerTaskStatus, event: DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData(MIME) || event.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const task = tasks.find((row) => row.id === id);
    if (!task || task.status === status || moving) return;
    void move(task, status);
  };

  const cold = tasksLoad.loading && !tasksLoad.data;
  const metrics: SalesMetric[] = [
    {
      label: 'Active',
      value: counts.open + counts.in_progress,
      hint: 'Open + in progress',
      tone: 'accent',
    },
    { label: 'Completed', value: counts.completed, hint: 'Finished', tone: 'ok' },
    {
      label: 'Overdue',
      value: overdueCount,
      hint: 'On this page',
      ...(overdueCount ? { tone: 'danger' as const } : {}),
    },
    { label: 'Total', value: total, hint: 'All assignments' },
  ];

  return (
    <SalesPage busy={cold || tasksLoad.revalidating}>
      <SalesPageHead
        description={NAV_DESC.tasks}
        {...(newCount > 0
          ? { eyebrow: `${newCount} new`, eyebrowIcon: 'clipboardCheck' as const }
          : {})}
        metrics={cold ? undefined : metrics}
      />

      {cold ? (
        <SalesBodySkeleton variant="board" />
      ) : (
        <>
        {tasksLoad.error ? <SalesErrorNote>{tasksLoad.error}</SalesErrorNote> : null}

        {tasks.length === 0 && !tasksLoad.error ? (
          <SalesEmpty
            icon="clipboardCheck"
            tone="ok"
            title="No assignments yet"
            body="When a manager or automation assigns work, it lands on this board."
          />
        ) : (
          <div className="ss-scroll ss-ret-board ss-tasks-board">
            {COLUMNS.map((col) => {
              const rows = byStatus[col.id];
              const dropActive = overCol === col.id && dragId != null;
              return (
                <div key={col.id} className="ss-ret-col">
                  <div className="ss-ret-col-head">
                    <div>
                      <div className="ss-ret-col-title" style={{ color: col.color }}>
                        <span className="ss-ret-col-dot" style={{ background: col.color }} />
                        {col.label}
                      </div>
                      <div className="ss-ret-col-hint">{col.hint}</div>
                    </div>
                    {/* The count of what is ON this column, not the account-wide total: the header
                        used to print `counts[col.id]` (every page) above a body holding one page's
                        rows, so a paginated board read "38 cards" over three visible cards. The
                        all-pages figures live in the header metric strip, which says so. */}
                    <div className="ss-ret-col-meta">
                      <strong>{rows.length}</strong>
                      {rows.length === 1 ? 'card' : 'cards'}
                    </div>
                  </div>
                  <div
                    className={`ss-ret-col-body${dropActive ? ' is-drop' : ''}`}
                    style={{
                      boxShadow: dropActive
                        ? `inset 0 2px 0 ${col.color}, inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent)`
                        : `inset 0 2px 0 ${col.color}`,
                    }}
                    onDragOver={(event) => onColumnDragOver(col.id, event)}
                    onDragLeave={() => {
                      if (overCol === col.id) setOverCol(null);
                    }}
                    onDrop={(event) => onColumnDrop(col.id, event)}
                  >
                    {rows.map((task, index) => {
                      const dragging = dragId === task.id;
                      const overdue = isOverdue(task);
                      const isNew = task.status === 'open' && !openedSet[task.id];
                      const rail = overdue ? 'var(--danger)' : priorityTone(task.priority);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          draggable={!moving}
                          onDragStart={(event) => onCardDragStart(task.id, event)}
                          onDragEnd={onCardDragEnd}
                          onClick={() => setSelectedId(task.id)}
                          className={`ss-ret-card ss-tasks-card${dragging ? ' is-dragging' : ''}${overdue ? ' is-overdue' : ''}${isNew ? ' is-new' : ''}`}
                          style={
                            {
                              ['--ret-col' as string]: rail,
                              animationDelay: `${Math.min(index, 8) * 30}ms`,
                              cursor: moving ? 'wait' : 'grab',
                            } as CSSProperties
                          }
                        >
                          <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:8px')}>
                            <div style={s('font-weight:750;font-size:var(--ss-text-sm);line-height:1.35;text-align:left')}>
                              {task.subject}
                            </div>
                            <span
                              style={s(
                                `flex-shrink:0;padding:2px 7px;border-radius:var(--radius-full);font-size:var(--ss-text-badge);font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${priorityTone(task.priority)} 14%,transparent);color:${priorityTone(task.priority)}`,
                              )}
                            >
                              {task.priority}
                            </span>
                          </div>
                          <div className="ss-ret-card-meta">
                            {task.taskType.replaceAll('_', ' ')} · {task.source}
                            {isNew ? ' · new' : ''}
                          </div>
                          <div
                            style={s(
                              `display:flex;align-items:center;gap:5px;margin-top:2px;font-size:var(--ss-text-2xs);font-weight:650;color:${overdue ? 'var(--danger)' : 'var(--muted)'}`,
                            )}
                          >
                            <Icon name="clock" size={12} />
                            {deadlineLabel(task.deadlineAt)}
                          </div>
                        </button>
                      );
                    })}
                    {rows.length === 0 ? (
                      <div className="ss-tasks-col-empty">Drop a card here</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {total > PAGE_SIZE ? (
          <SalesPager
            page={page}
            pageCount={pageCount}
            onPage={setPage}
            summary={`Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} assignments`}
          />
        ) : null}
        </>
      )}

      {selected ? (
        <TaskDetailModal
          task={selected}
          moving={moving}
          onClose={() => setSelectedId(null)}
          onMove={(status) => void move(selected, status)}
        />
      ) : null}
    </SalesPage>
  );
}
