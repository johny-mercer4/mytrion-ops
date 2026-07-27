import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listMyTaskEvents,
  listMyTasks,
  moveMyTask,
  type WorkerTaskDto,
  type WorkerTaskEventDto,
} from '@/api/salesKpi';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';

function deadlineLabel(value: string | null): string {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status: WorkerTaskDto['status']): string {
  return status.replace('_', ' ');
}

export function TasksTab() {
  const { pushToast } = useSales();
  const [tasks, setTasks] = useState<WorkerTaskDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<WorkerTaskEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listMyTasks());
    } catch (error) {
      pushToast('Tasks unavailable', error instanceof Error ? error.message : 'Try again shortly.');
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    void listMyTaskEvents(selectedId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [selectedId, selected?.version]);

  const grouped = useMemo(
    () => ({
      active: tasks.filter((task) => task.status === 'open' || task.status === 'in_progress'),
      finished: tasks.filter((task) => task.status === 'completed' || task.status === 'cancelled'),
    }),
    [tasks],
  );

  const move = async (task: WorkerTaskDto, status: 'in_progress' | 'completed'): Promise<void> => {
    setMoving(true);
    try {
      const updated = await moveMyTask(task.id, task.version, status);
      setTasks((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      pushToast(status === 'completed' ? 'Task completed' : 'Task started', updated.subject);
    } catch (error) {
      pushToast('Task not updated', error instanceof Error ? error.message : 'Refresh and try again.');
      await load();
    } finally {
      setMoving(false);
    }
  };

  return (
    <div style={s('display:flex;flex-direction:column;gap:18px')}>
      <div style={s('display:flex;align-items:flex-end;justify-content:space-between;gap:16px')}>
        <div>
          <div style={s("font-family:Rajdhani,sans-serif;font-size:25px;font-weight:700;letter-spacing:.04em")}>
            My Tasks
          </div>
          <div style={s('margin-top:4px;color:var(--muted);font-size:13px')}>
            Assignments, deadlines and progress in one place.
          </div>
        </div>
        <button className="ss-ico-btn" onClick={() => void load()} style={s('height:36px;padding:0 13px;display:flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--text2);font-weight:700;cursor:pointer')}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>

      <div style={s('display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,.8fr);gap:16px;align-items:start')}>
        <div style={s('display:flex;flex-direction:column;gap:14px')}>
          {loading ? (
            <div style={s('padding:28px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--muted)')}>
              Loading assignments…
            </div>
          ) : grouped.active.length === 0 ? (
            <div style={s('padding:34px;text-align:center;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)')}>
              <Icon name="clipboardCheck" size={28} color="var(--ok)" />
              <div style={s('margin-top:10px;font-weight:700')}>No open assignments</div>
              <div style={s('margin-top:4px;color:var(--muted);font-size:13px')}>You are all caught up.</div>
            </div>
          ) : (
            grouped.active.map((task) => (
              <article
                key={task.id}
                onClick={() => setSelectedId(task.id)}
                style={s(`padding:16px;border:1px solid ${selectedId === task.id ? 'color-mix(in srgb,var(--accent) 55%,var(--border))' : 'var(--border)'};border-left:3px solid ${task.priority === 'urgent' ? 'var(--danger)' : task.priority === 'high' ? 'var(--warn)' : 'var(--accent)'};border-radius:var(--radius-md);background:var(--surface);box-shadow:var(--shadow-sm);cursor:pointer`)}
              >
                <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px')}>
                  <div style={s('min-width:0')}>
                    <div style={s('font-weight:750;font-size:15px')}>{task.subject}</div>
                    <div style={s('margin-top:5px;color:var(--muted);font-size:12px;text-transform:capitalize')}>
                      {task.taskType} · {task.priority}
                    </div>
                  </div>
                  <span style={s('padding:4px 8px;border-radius:99px;background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent-text);font-size:11px;font-weight:800;text-transform:uppercase')}>
                    {statusLabel(task.status)}
                  </span>
                </div>
                {task.description ? (
                  <p style={s('margin:11px 0 0;color:var(--text2);font-size:13px;line-height:1.55')}>
                    {task.description}
                  </p>
                ) : null}
                <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:13px;padding-top:12px;border-top:1px solid var(--border2)')}>
                  <span style={s('display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px')}>
                    <Icon name="clock" size={13} /> {deadlineLabel(task.deadlineAt)}
                  </span>
                  {task.status === 'open' ? (
                    <button disabled={moving} onClick={(event) => { event.stopPropagation(); void move(task, 'in_progress'); }} style={s('height:32px;padding:0 12px;border:1px solid var(--accent);border-radius:var(--radius-md);background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent-text);font-weight:750;cursor:pointer')}>
                      Start task
                    </button>
                  ) : (
                    <button disabled={moving} onClick={(event) => { event.stopPropagation(); void move(task, 'completed'); }} style={s('height:32px;padding:0 12px;border:1px solid color-mix(in srgb,var(--ok) 55%,var(--border));border-radius:var(--radius-md);background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok);font-weight:750;cursor:pointer')}>
                      Complete
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
          {grouped.finished.length ? (
            <details>
              <summary style={s('cursor:pointer;color:var(--muted);font-size:13px;font-weight:700')}>
                Completed or cancelled ({grouped.finished.length})
              </summary>
              <div style={s('display:flex;flex-direction:column;gap:8px;margin-top:10px')}>
                {grouped.finished.map((task) => (
                  <button key={task.id} onClick={() => setSelectedId(task.id)} style={s('display:flex;justify-content:space-between;gap:12px;padding:11px 13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--text2);cursor:pointer;text-align:left')}>
                    <span>{task.subject}</span>
                    <span style={s('color:var(--muted);text-transform:capitalize')}>{statusLabel(task.status)}</span>
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </div>

        <aside style={s('position:sticky;top:12px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)')}>
          <div style={s('font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em')}>History</div>
          {!selected ? (
            <p style={s('margin:12px 0 0;color:var(--muted);font-size:13px;line-height:1.5')}>
              Select an assignment to see its event history.
            </p>
          ) : (
            <div style={s('display:flex;flex-direction:column;gap:12px;margin-top:13px')}>
              <div style={s('font-weight:700')}>{selected.subject}</div>
              {events.map((event) => (
                <div key={event.id} style={s('padding-left:11px;border-left:2px solid var(--border);font-size:12px')}>
                  <div style={s('font-weight:700;text-transform:capitalize')}>{event.eventType.replaceAll('_', ' ')}</div>
                  <div style={s('margin-top:3px;color:var(--muted)')}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
