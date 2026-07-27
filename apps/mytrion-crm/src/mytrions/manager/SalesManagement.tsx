import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Send, XCircle } from 'lucide-react';
import {
  createManagerTask,
  listKpiWorkers,
  listManagerTasks,
  listTaskTypes,
  updateManagerTask,
  type KpiWorkerDto,
  type TaskTypeDto,
  type WorkerTaskDto,
  type WorkerTaskPriority,
  type WorkerTaskStatus,
} from '../../api/salesKpi';
import './salesManagement.css';

function friendly(value: string): string {
  return value.replaceAll('_', ' ');
}

function deadlineInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

export function SalesManagement() {
  const [workers, setWorkers] = useState<KpiWorkerDto[]>([]);
  const [types, setTypes] = useState<TaskTypeDto[]>([]);
  const [tasks, setTasks] = useState<WorkerTaskDto[]>([]);
  const [filterWorker, setFilterWorker] = useState('');
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
        listKpiWorkers(),
        listTaskTypes(),
        listManagerTasks(),
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
      setError(caught instanceof Error ? caught.message : 'Sales management data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleTasks = useMemo(
    () => filterWorker ? tasks.filter((task) => task.assigneeZohoUserId === filterWorker) : tasks,
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
      const created = await createManagerTask({
        assigneeZohoUserId: form.assigneeZohoUserId,
        type: form.type,
        subject: form.subject.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(normalizedDeadline ? { deadlineAt: normalizedDeadline } : {}),
        priority: form.priority,
      });
      setTasks((rows) => [created, ...rows]);
      setForm((current) => ({ ...current, subject: '', description: '', deadlineAt: '' }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The task could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const patchTask = async (
    task: WorkerTaskDto,
    change: { status?: WorkerTaskStatus; assigneeZohoUserId?: string; comment?: string },
  ): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateManagerTask(task.id, { version: task.version, ...change });
      setTasks((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The task changed elsewhere. Refresh and retry.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mg-sales">
      <header className="mg-sales__header">
        <div>
          <p className="mg-sales__eyebrow">Manager · Sales</p>
          <h1>Sales operations</h1>
          <p>Assign and manage work for Sales agents. KPI collection is monitored in Mytrion Admin.</p>
        </div>
        <button className="mg-sales__button mg-sales__button--ghost" onClick={() => void load()}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>

      {error ? <div className="mg-sales__error">{error}</div> : null}
      {loading ? <div className="mg-sales__empty">Loading Sales operations…</div> : null}

      {!loading ? (
        <div className="mg-sales__task-grid">
          <form className="mg-sales__panel mg-sales__form" onSubmit={(event) => void createTask(event)}>
            <div className="mg-sales__panel-title">New assignment</div>
            <label>
              Agent
              <select value={form.assigneeZohoUserId} onChange={(event) => setForm((current) => ({ ...current, assigneeZohoUserId: event.target.value }))}>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.zohoUserId}>
                    {worker.displayName ?? worker.email ?? worker.zohoUserId}
                  </option>
                ))}
              </select>
            </label>
            <div className="mg-sales__form-row">
              <label>
                Type
                <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}>
                  {types.map((type) => <option key={type.id} value={type.code}>{type.label}</option>)}
                </select>
              </label>
              <label>
                Priority
                <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as WorkerTaskPriority }))}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
            <label>
              Subject
              <input required maxLength={200} value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
            </label>
            <label>
              Description
              <textarea rows={4} maxLength={10_000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label>
              Deadline (optional)
              <input type="datetime-local" value={form.deadlineAt} onChange={(event) => setForm((current) => ({ ...current, deadlineAt: event.target.value }))} />
            </label>
            <button className="mg-sales__button" disabled={saving || !workers.length}>
              <Send size={15} /> Assign task
            </button>
          </form>

          <div className="mg-sales__panel">
            <div className="mg-sales__list-head">
              <div className="mg-sales__panel-title">Assignments</div>
              <select aria-label="Filter by agent" value={filterWorker} onChange={(event) => setFilterWorker(event.target.value)}>
                <option value="">All agents</option>
                {workers.map((worker) => <option key={worker.id} value={worker.zohoUserId}>{worker.displayName ?? worker.zohoUserId}</option>)}
              </select>
            </div>
            <div className="mg-sales__task-list">
              {visibleTasks.length === 0 ? <div className="mg-sales__empty">No assignments match this filter.</div> : null}
              {visibleTasks.map((task) => (
                <article className="mg-sales__task" key={task.id}>
                  <div className="mg-sales__task-top">
                    <div>
                      <strong>{task.subject}</strong>
                      <span>{workerName(task.assigneeZohoUserId)} · {friendly(task.taskType)}</span>
                    </div>
                    <span className={`mg-sales__pill mg-sales__pill--${task.priority}`}>{task.priority}</span>
                  </div>
                  {task.description ? <p>{task.description}</p> : null}
                  <div className="mg-sales__task-meta">
                    <span>{friendly(task.status)}</span>
                    <span>{task.deadlineAt ? new Date(task.deadlineAt).toLocaleString() : 'No deadline'}</span>
                  </div>
                  <div className="mg-sales__task-actions">
                    <select
                      aria-label={`Reassign ${task.subject}`}
                      value={task.assigneeZohoUserId}
                      disabled={saving}
                      onChange={(event) => void patchTask(task, { assigneeZohoUserId: event.target.value })}
                    >
                      {workers.map((worker) => <option key={worker.id} value={worker.zohoUserId}>{worker.displayName ?? worker.zohoUserId}</option>)}
                    </select>
                    {(task.status === 'completed' || task.status === 'cancelled') ? (
                      <button disabled={saving} onClick={() => void patchTask(task, { status: 'open' })}>Reopen</button>
                    ) : (
                      <button disabled={saving} onClick={() => void patchTask(task, { status: 'cancelled' })}>
                        <XCircle size={13} /> Cancel
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}
