/**
 * Department Tasks block — assign, list, and a detail pane with event history.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Send, XCircle } from 'lucide-react';
import type { WorkerTaskDto, WorkerTaskEventDto, WorkerTaskPriority, WorkerTaskStatus } from '../../../api/salesKpi';
import {
  createManagerDeptTask,
  listManagerAssignees,
  listManagerDeptTaskEvents,
  listManagerDeptTaskTypes,
  listManagerDeptTasks,
  updateManagerDeptTask,
  type ManagerAssigneeDto,
  type ManagerTaskDepartment,
} from '../../../api/managerTasks';
import './tasksBlock.css';

function friendly(value: string): string {
  return value.replaceAll('_', ' ');
}

function deadlineInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function deadlineLabel(value: string | null): string {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function TasksBlock({ department }: { department: ManagerTaskDepartment }) {
  const [workers, setWorkers] = useState<ManagerAssigneeDto[]>([]);
  const [types, setTypes] = useState<Array<{ id: string; code: string; label: string }>>([]);
  const [tasks, setTasks] = useState<WorkerTaskDto[]>([]);
  const [filterWorker, setFilterWorker] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<WorkerTaskEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    assigneeZohoUserId: '',
    type: 'general',
    subject: '',
    description: '',
    deadlineAt: '',
    priority: 'normal' as WorkerTaskPriority,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workerRows, typeRows, taskRows] = await Promise.all([
        listManagerAssignees(department),
        listManagerDeptTaskTypes(department),
        listManagerDeptTasks(department),
      ]);
      setWorkers(workerRows);
      setTypes(typeRows);
      setTasks(taskRows);
      setForm((current) => ({
        ...current,
        assigneeZohoUserId: current.assigneeZohoUserId || workerRows[0]?.zohoUserId || '',
        type: current.type || typeRows[0]?.code || 'general',
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Tasks could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [department]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = tasks.find((task) => task.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    void listManagerDeptTaskEvents(department, selectedId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [department, selectedId, selected?.version]);

  const visibleTasks = useMemo(
    () => (filterWorker ? tasks.filter((task) => task.assigneeZohoUserId === filterWorker) : tasks),
    [filterWorker, tasks],
  );

  const workerName = (id: string): string =>
    workers.find((worker) => worker.zohoUserId === id)?.displayName ?? id;

  const createTask = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!form.assigneeZohoUserId || !form.subject.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const normalizedDeadline = deadlineInput(form.deadlineAt);
      const created = await createManagerDeptTask(department, {
        assigneeZohoUserId: form.assigneeZohoUserId,
        type: form.type,
        subject: form.subject.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(normalizedDeadline ? { deadlineAt: normalizedDeadline } : {}),
        priority: form.priority,
      });
      setTasks((rows) => [created, ...rows]);
      setSelectedId(created.id);
      setForm((current) => ({ ...current, subject: '', description: '', deadlineAt: '' }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The task could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const patchTask = async (
    task: WorkerTaskDto,
    change: {
      status?: WorkerTaskStatus;
      assigneeZohoUserId?: string;
      comment?: string;
    },
  ): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateManagerDeptTask(department, task.id, {
        version: task.version,
        ...change,
      });
      setTasks((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The task changed elsewhere. Refresh and retry.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mg-block" aria-labelledby={`mg-tasks-${department}`}>
      <header className="mg-block-head">
        <div>
          <p className="mg-block-kicker">Workspace block</p>
          <h2 className="mg-block-title" id={`mg-tasks-${department}`}>
            Tasks
          </h2>
          <p className="mg-block-sub">
            Assign work to this department&rsquo;s agents, track status, and open any assignment for
            full detail and history.
          </p>
        </div>
        <button type="button" className="mg-tasks-btn mg-tasks-btn--ghost" onClick={() => void load()}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>

      {error ? <div className="mg-tasks-error">{error}</div> : null}
      {loading ? <div className="mg-tasks-empty">Loading tasks…</div> : null}

      {!loading ? (
        <div className="mg-tasks-layout">
          <form className="mg-tasks-panel mg-tasks-form" onSubmit={(event) => void createTask(event)}>
            <div className="mg-tasks-panel-title">New assignment</div>
            <label>
              Agent
              <select
                value={form.assigneeZohoUserId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, assigneeZohoUserId: event.target.value }))
                }
              >
                {workers.length === 0 ? <option value="">No agents available</option> : null}
                {workers.map((worker) => (
                  <option key={worker.zohoUserId} value={worker.zohoUserId}>
                    {worker.displayName ?? worker.email ?? worker.zohoUserId}
                  </option>
                ))}
              </select>
            </label>
            <div className="mg-tasks-form-row">
              <label>
                Type
                <select
                  value={form.type}
                  onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.code}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority
                <select
                  value={form.priority}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priority: event.target.value as WorkerTaskPriority,
                    }))
                  }
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
            <label>
              Subject
              <input
                required
                maxLength={200}
                value={form.subject}
                onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
              />
            </label>
            <label>
              Description
              <textarea
                rows={4}
                maxLength={10_000}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
            <label>
              Deadline (optional)
              <input
                type="datetime-local"
                value={form.deadlineAt}
                onChange={(event) =>
                  setForm((current) => ({ ...current, deadlineAt: event.target.value }))
                }
              />
            </label>
            <button className="mg-tasks-btn" disabled={saving || !workers.length} type="submit">
              <Send size={15} /> Assign task
            </button>
          </form>

          <div className="mg-tasks-panel">
            <div className="mg-tasks-list-head">
              <div className="mg-tasks-panel-title">Assignments</div>
              <select
                aria-label="Filter by agent"
                value={filterWorker}
                onChange={(event) => setFilterWorker(event.target.value)}
              >
                <option value="">All agents</option>
                {workers.map((worker) => (
                  <option key={worker.zohoUserId} value={worker.zohoUserId}>
                    {worker.displayName ?? worker.zohoUserId}
                  </option>
                ))}
              </select>
            </div>
            <div className="mg-tasks-list">
              {visibleTasks.length === 0 ? (
                <div className="mg-tasks-empty">No assignments match this filter.</div>
              ) : null}
              {visibleTasks.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  className={`mg-tasks-card${selectedId === task.id ? ' is-on' : ''}`}
                  data-priority={task.priority}
                  onClick={() => setSelectedId(task.id)}
                >
                  <div className="mg-tasks-card-top">
                    <div>
                      <strong>{task.subject}</strong>
                      <span>
                        {workerName(task.assigneeZohoUserId)} · {friendly(task.taskType)}
                      </span>
                    </div>
                    <span className="mg-tasks-pill" data-priority={task.priority}>
                      {task.priority}
                    </span>
                  </div>
                  <div className="mg-tasks-card-meta">
                    <span>{friendly(task.status)}</span>
                    <span>{deadlineLabel(task.deadlineAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mg-tasks-panel mg-tasks-detail">
            <div className="mg-tasks-panel-title">Task detail</div>
            {!selected ? (
              <div className="mg-tasks-empty">Select an assignment to see detail and history.</div>
            ) : (
              <>
                <div className="mg-tasks-detail-hero">
                  <h3>{selected.subject}</h3>
                  {selected.description ? <p>{selected.description}</p> : <p>No description.</p>}
                </div>
                <div className="mg-tasks-detail-grid">
                  <div className="mg-tasks-stat">
                    <span>Status</span>
                    <strong>{friendly(selected.status)}</strong>
                  </div>
                  <div className="mg-tasks-stat">
                    <span>Priority</span>
                    <strong>{selected.priority}</strong>
                  </div>
                  <div className="mg-tasks-stat">
                    <span>Assignee</span>
                    <strong>{workerName(selected.assigneeZohoUserId)}</strong>
                  </div>
                  <div className="mg-tasks-stat">
                    <span>Deadline</span>
                    <strong>{deadlineLabel(selected.deadlineAt)}</strong>
                  </div>
                </div>

                <div className="mg-tasks-actions">
                  <select
                    aria-label={`Reassign ${selected.subject}`}
                    value={selected.assigneeZohoUserId}
                    disabled={saving}
                    onChange={(event) =>
                      void patchTask(selected, { assigneeZohoUserId: event.target.value })
                    }
                  >
                    {workers.map((worker) => (
                      <option key={worker.zohoUserId} value={worker.zohoUserId}>
                        {worker.displayName ?? worker.zohoUserId}
                      </option>
                    ))}
                  </select>
                  {selected.status === 'completed' || selected.status === 'cancelled' ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void patchTask(selected, { status: 'open' })}
                    >
                      Reopen
                    </button>
                  ) : (
                    <>
                      {selected.status === 'open' ? (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void patchTask(selected, { status: 'in_progress' })}
                        >
                          Start
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void patchTask(selected, { status: 'completed' })}
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        disabled={saving}
                        onClick={() => void patchTask(selected, { status: 'cancelled' })}
                      >
                        <XCircle size={13} /> Cancel
                      </button>
                    </>
                  )}
                </div>

                <div>
                  <div className="mg-tasks-panel-title" style={{ marginBottom: 10 }}>
                    History
                  </div>
                  {events.length === 0 ? (
                    <div className="mg-tasks-empty">No events yet.</div>
                  ) : (
                    <ul className="mg-tasks-timeline">
                      {[...events].reverse().map((event) => (
                        <li key={event.id}>
                          <strong>{friendly(event.eventType)}</strong>
                          <span>
                            {event.fromStatus && event.toStatus
                              ? `${friendly(event.fromStatus)} → ${friendly(event.toStatus)} · `
                              : ''}
                            {new Date(event.occurredAt).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
