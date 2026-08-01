/**
 * Sales My Tasks — status kanban (Open → In progress → Completed → Cancelled).
 * Cards drag between columns to PATCH `/sales/tasks/:id/status`; click opens detail modal.
 * Reuses Retention board chrome (`.ss-ret-*`) so the desk matches Horizon patterns.
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
  listMyTasks,
  moveMyTask,
  type WorkerTaskDto,
  type WorkerTaskStatus,
} from '@/api/salesKpi';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { useCachedLoad, writeDcCache } from '../dcCache';
import { TaskDetailModal } from '../TaskDetailModal';
import { TasksBoardSkeleton } from '../TasksBoardSkeleton';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { markTaskOpened, useTaskOpened } from '../taskOpened';
import { tasksBadgeCacheKey } from '../tasksLiveBus';

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
  const cacheKey = tasksBadgeCacheKey(currentUserId);
  const tasksLoad = useCachedLoad(cacheKey, () => listMyTasks(), { staleMs: 60_000 });
  const tasks = tasksLoad.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<WorkerTaskStatus | null>(null);

  const syncCache = useCallback(
    (rows: WorkerTaskDto[]) => {
      // Shared SWR key with the shell badge — write adopts instantly (no refetch race).
      writeDcCache(cacheKey, rows);
    },
    [cacheKey],
  );

  const selected = tasks.find((task) => task.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
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

  const openCount = byStatus.open.length + byStatus.in_progress.length;
  const overdueCount = tasks.filter(isOverdue).length;
  const newCount = byStatus.open.filter((task) => !openedSet[task.id]).length;

  const move = async (task: WorkerTaskDto, status: WorkerTaskStatus): Promise<void> => {
    if (task.status === status) return;
    setMoving(true);
    const previous = tasks;
    const optimistic = tasks.map((row) =>
      row.id === task.id ? { ...row, status, version: row.version + 1 } : row,
    );
    syncCache(optimistic);
    try {
      const updated = await moveMyTask(task.id, task.version, status);
      const next = optimistic.map((row) => (row.id === updated.id ? updated : row));
      syncCache(next);
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

  if (tasksLoad.loading && !tasksLoad.data) {
    return <TasksBoardSkeleton />;
  }

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px;min-height:0')}>
      <div className="ss-ret-hero ss-tasks-hero">
        <div style={s('display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap')}>
          <div>
            <div className="ss-ret-hero-kicker">
              <Icon name="clipboardCheck" size={13} /> Assignments
              {newCount > 0 ? (
                <span className="ss-tasks-new-pill">{newCount} new</span>
              ) : null}
            </div>
            <div className="ss-ret-hero-title">My Tasks</div>
            <p className="ss-ret-hero-sub">
              Drag cards across columns to update status. Open any card for full detail and history.
            </p>
          </div>
          <button
            type="button"
            className="ss-ico-btn ss-tasks-refresh"
            onClick={() => void tasksLoad.reload()}
            style={s(
              'height:36px;padding:0 13px;display:flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--text2);font-weight:700;cursor:pointer',
            )}
          >
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
        <div className="ss-ret-metrics" style={{ marginTop: 4 }}>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Active</div>
            <div className="ss-ret-metric-val is-accent">{openCount}</div>
            <div className="ss-ret-metric-hint">Open + in progress</div>
          </div>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Completed</div>
            <div className="ss-ret-metric-val is-ok">{byStatus.completed.length}</div>
            <div className="ss-ret-metric-hint">Finished</div>
          </div>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Overdue</div>
            <div className={`ss-ret-metric-val${overdueCount ? ' is-danger' : ''}`}>{overdueCount}</div>
            <div className="ss-ret-metric-hint">Past deadline</div>
          </div>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Total</div>
            <div className="ss-ret-metric-val">{tasks.length}</div>
            <div className="ss-ret-metric-hint">All assignments</div>
          </div>
        </div>
      </div>

      {tasksLoad.error && tasks.length === 0 ? (
        <div
          style={s(
            'padding:28px;border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));border-radius:var(--radius-md);background:var(--surface);color:var(--danger)',
          )}
        >
          {tasksLoad.error}
        </div>
      ) : null}

      {tasks.length === 0 && !tasksLoad.error ? (
        <div className="ss-tasks-empty">
          <Icon name="clipboardCheck" size={28} color="var(--ok)" />
          <div style={s('margin-top:10px;font-weight:700')}>No assignments yet</div>
          <div style={s('margin-top:4px;color:var(--muted);font-size:13px')}>
            When a manager or automation assigns work, it lands on this board.
          </div>
        </div>
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
                  <div className="ss-ret-col-meta">
                    <strong>{rows.length}</strong>
                    cards
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
                          <div style={s('font-weight:750;font-size:13.5px;line-height:1.35;text-align:left')}>
                            {task.subject}
                          </div>
                          <span
                            style={s(
                              `flex-shrink:0;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${priorityTone(task.priority)} 14%,transparent);color:${priorityTone(task.priority)}`,
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
                            `display:flex;align-items:center;gap:5px;margin-top:2px;font-size:11.5px;font-weight:650;color:${overdue ? 'var(--danger)' : 'var(--muted)'}`,
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

      {selected ? (
        <TaskDetailModal
          task={selected}
          moving={moving}
          onClose={() => setSelectedId(null)}
          onMove={(status) => void move(selected, status)}
        />
      ) : null}
    </div>
  );
}
