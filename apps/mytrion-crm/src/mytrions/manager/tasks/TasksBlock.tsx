/**
 * Department Tasks — the Manager workspace block, on every desk.
 *
 * Shape and vocabulary deliberately mirror the agent's own board
 * (`sales/redesign/tabs/TasksTab.tsx`): same four columns, same order, same priority hues, same
 * overdue rule, drag a card to move it. Manager and agent are reading one table
 * (`mytrion_worker_tasks`) and should not need two mental models of it. What the manager gets on
 * top is the assign dialog, the assignee filter, and the per-agent load read.
 *
 * Data: `/v1/manager/:department/tasks` returns the page, the desk-wide status counts, and the
 * open-load per assignee. The counts are desk-wide ON PURPOSE — they are what you read to decide
 * which status to filter by, so they must not follow the filter.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { Select } from '@/ds';
import type {
  TaskTypeDto,
  WorkerTaskDto,
  WorkerTaskEventDto,
  WorkerTaskStatus,
} from '../../../api/salesKpi';
import {
  createManagerDeptTask,
  listManagerAssignees,
  listManagerDeptTaskEvents,
  listManagerDeptTaskTypes,
  listManagerDeptTasks,
  updateManagerDeptTask,
  type ManagerAssigneeDto,
  type ManagerAssigneeLoad,
  type ManagerTaskCounts,
  type ManagerTaskDepartment,
} from '../../../api/managerTasks';
import { TaskAssignModal, type TaskDraft } from './TaskAssignModal';
import { TaskDetailModal } from './TaskDetailModal';
import {
  PRIORITIES,
  TASK_COLUMNS,
  deadlineLabel,
  friendly,
  groupByStatus,
  isOverdue,
  priorityTone,
} from './taskModel';
import { TasksBoardSkeleton } from '../ManagerSkeletons';
import './tasksBlock.css';

const MIME = 'application/x-mytrion-task-id';
const PAGE_SIZE = 200;
const EMPTY_COUNTS: ManagerTaskCounts = { open: 0, in_progress: 0, completed: 0, cancelled: 0 };

/**
 * Per-desk roster cache, module-scoped so it survives navigating between departments and back.
 * The underlying call is 2.7–4.9s and its answer changes on the timescale of HR changes, not of
 * a page view.
 */
const rosterCache = new Map<
  ManagerTaskDepartment,
  { workers: ManagerAssigneeDto[]; types: TaskTypeDto[] }
>();

export function TasksBlock({
  department,
  departmentLabel,
}: {
  department: ManagerTaskDepartment;
  departmentLabel: string;
}) {
  const [workers, setWorkers] = useState<ManagerAssigneeDto[]>([]);
  const [types, setTypes] = useState<TaskTypeDto[]>([]);
  const [tasks, setTasks] = useState<WorkerTaskDto[]>([]);
  const [counts, setCounts] = useState<ManagerTaskCounts>(EMPTY_COUNTS);
  const [load, setLoad] = useState<ManagerAssigneeLoad[]>([]);
  const [total, setTotal] = useState(0);

  const [query, setQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<WorkerTaskEventDto[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<WorkerTaskStatus | null>(null);

  // Debounced so typing in the search box does not fire a request per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  /**
   * The roster and type catalog change rarely and are SLOW — `listManagerAssignees` measured
   * 2.7s for Sales and 4.9s for Billing (it resolves the Zoho user directory). They are therefore
   * cached per desk for the session and, critically, are NOT on the board's critical path: the
   * board renders from the task list alone, and the agent filter and Assign button simply fill in
   * when the roster lands.
   */
  useEffect(() => {
    let cancelled = false;
    const cached = rosterCache.get(department);
    if (cached) {
      setWorkers(cached.workers);
      setTypes(cached.types);
      return;
    }
    void Promise.all([listManagerAssignees(department), listManagerDeptTaskTypes(department)])
      .then(([workerRows, typeRows]) => {
        rosterCache.set(department, { workers: workerRows, types: typeRows });
        if (cancelled) return;
        setWorkers(workerRows);
        setTypes(typeRows);
      })
      .catch(() => {
        // A failed roster is not a failed board — the task list still renders and reports its own
        // error. It only means the assign dialog has nobody to offer yet.
        if (!cancelled) setWorkers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [department]);

  const loadTasks = useCallback(
    async (mode: 'cold' | 'refresh' = 'cold') => {
      if (mode === 'cold') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const page = await listManagerDeptTasks(department, {
          limit: PAGE_SIZE,
          ...(assigneeFilter ? { assigneeZohoUserId: assigneeFilter } : {}),
          ...(priorityFilter ? { priority: priorityFilter as WorkerTaskDto['priority'] } : {}),
          ...(debouncedQuery ? { q: debouncedQuery } : {}),
        });
        setTasks(page.tasks);
        setCounts(page.counts);
        setLoad(page.load);
        setTotal(page.pagination.total);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Tasks could not be loaded.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [department, assigneeFilter, priorityFilter, debouncedQuery],
  );

  // A filter change is a refresh, not a cold start: replacing a populated board with a skeleton on
  // every keystroke is the flicker that makes a filtered list feel broken.
  const firstLoad = useRef(true);
  useEffect(() => {
    void loadTasks(firstLoad.current ? 'cold' : 'refresh');
    firstLoad.current = false;
  }, [loadTasks]);
  useEffect(() => {
    firstLoad.current = true;
  }, [department]);

  const selected = tasks.find((task) => task.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    void listManagerDeptTaskEvents(department, selectedId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [department, selectedId, selected?.version]);

  const board = useMemo(() => groupByStatus(tasks), [tasks]);
  const overdue = useMemo(() => tasks.filter((task) => isOverdue(task)).length, [tasks]);
  const workerName = useCallback(
    (id: string): string =>
      workers.find((worker) => worker.zohoUserId === id)?.displayName ?? id,
    [workers],
  );
  const busiest = useMemo(
    () => [...load].sort((a, b) => b.open - a.open).slice(0, 3),
    [load],
  );
  const filtered = Boolean(assigneeFilter || priorityFilter || debouncedQuery);

  const patch = async (
    task: WorkerTaskDto,
    change: { status?: WorkerTaskStatus; assigneeZohoUserId?: string },
  ): Promise<void> => {
    setSaving(true);
    setActionError(null);
    // Optimistic: the board answers immediately, and a failure restores the row and says so.
    const previous = tasks;
    setTasks((rows) =>
      rows.map((row) => (row.id === task.id ? { ...row, ...change, version: row.version + 1 } : row)),
    );
    try {
      const updated = await updateManagerDeptTask(department, task.id, {
        version: task.version,
        ...change,
      });
      setTasks((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      // Status counts and the load read are desk-wide, so only the server can restate them.
      await loadTasks('refresh');
    } catch (caught) {
      setTasks(previous);
      setActionError(
        caught instanceof Error ? caught.message : 'The task changed elsewhere. Refresh and retry.',
      );
    } finally {
      setSaving(false);
    }
  };

  const assign = async (draft: TaskDraft): Promise<void> => {
    setSaving(true);
    setActionError(null);
    try {
      const created = await createManagerDeptTask(department, draft);
      setAssignOpen(false);
      setSelectedId(created.id);
      await loadTasks('refresh');
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The task could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const onDrop = (status: WorkerTaskStatus, event: DragEvent): void => {
    event.preventDefault();
    const id =
      event.dataTransfer.getData(MIME) || event.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    setOverColumn(null);
    if (!id) return;
    const task = tasks.find((row) => row.id === id);
    if (!task || task.status === status || saving) return;
    void patch(task, { status });
  };

  const active = counts.open + counts.in_progress;

  return (
    <section className="mg-block mg-tk" aria-labelledby={`mg-tasks-${department}`}>
      <header className="mg-block-head">
        <div>
          <p className="mg-block-kicker">Workspace block</p>
          <h2 className="mg-block-title" id={`mg-tasks-${department}`}>
            Tasks
          </h2>
          <p className="mg-block-sub">
            Assign work to this department&rsquo;s agents and track it to done. Drag a card between
            columns to move it, or open one for full detail and history.
          </p>
        </div>
        <div className="mg-tk-head-actions">
          <button
            type="button"
            className="mg-btn"
            onClick={() => void loadTasks('refresh')}
            disabled={loading || refreshing}
          >
            <RefreshCw size={15} className={refreshing ? 'mg-spin' : ''} />
            Refresh
          </button>
          <button type="button" className="mg-btn-primary" onClick={() => setAssignOpen(true)}>
            <Plus size={15} />
            Assign task
          </button>
        </div>
      </header>

      {/*
       * The block's own chrome — metrics, filters — renders IMMEDIATELY, at zero, and fills in.
       * It used to sit behind a full-block skeleton, so a desk with no records still showed a
       * loading graphic for as long as the round trip took. A block whose numbers are all zero is
       * a truthful answer; a skeleton is a promise that something is coming.
       */}
          <div className="mg-tk-metrics">
            <div>
              <span>Active</span>
              <strong>{active}</strong>
              <em>Open + in progress</em>
            </div>
            <div className={overdue ? 'is-bad' : ''}>
              <span>Overdue</span>
              <strong>{overdue}</strong>
              <em>Past deadline, still open</em>
            </div>
            <div>
              <span>Completed</span>
              <strong>{counts.completed}</strong>
              <em>All time on this desk</em>
            </div>
            <div>
              <span>Agents loaded</span>
              <strong>{busiest.filter((row) => row.open > 0).length}</strong>
              <em>
                {busiest.length && busiest[0] && busiest[0].open > 0
                  ? `Most: ${workerName(busiest[0].assigneeZohoUserId)} · ${busiest[0].open}`
                  : 'Nobody has open work'}
              </em>
            </div>
          </div>

          <div className="mg-tk-filters">
            <label className="mg-search">
              <Search size={15} />
              <input
                type="search"
                value={query}
                placeholder="Search subject, description or type…"
                aria-label="Search tasks"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="mg-tk-select">
              <Users size={14} aria-hidden />
              <Select
                label="Filter by agent"
                labelHidden
                size="sm"
                placeholder="All agents"
                clearable
                options={workers.map((worker) => ({
                  value: worker.zohoUserId,
                  label: worker.displayName ?? worker.zohoUserId,
                }))}
                value={assigneeFilter || null}
                onChange={(value) => setAssigneeFilter(value ?? '')}
              />
            </div>
            <label className="mg-tk-select">
              <select
                aria-label="Filter by priority"
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value)}
              >
                <option value="">Any priority</option>
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {value[0]?.toUpperCase()}
                    {value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            {filtered ? (
              <button
                type="button"
                className="mg-btn"
                onClick={() => {
                  setQuery('');
                  setAssigneeFilter('');
                  setPriorityFilter('');
                }}
              >
                Clear
              </button>
            ) : null}
            <span className="mg-tk-result-count" aria-live="polite">
              {refreshing ? 'Updating…' : `${total} ${total === 1 ? 'task' : 'tasks'}`}
            </span>
          </div>

          {error ? (
            <div className="mg-error">
              <p>{error}</p>
              <button type="button" className="mg-btn" onClick={() => void loadTasks('cold')}>
                Retry
              </button>
            </div>
          ) : null}
          {actionError ? (
            <div className="mg-tk-error" role="alert">
              <AlertTriangle size={15} aria-hidden />
              {actionError}
            </div>
          ) : null}

          {loading ? <TasksBoardSkeleton /> : null}

          {!loading && !error && tasks.length === 0 ? (
            <div className="mg-empty">
              {filtered
                ? 'No tasks match these filters.'
                : `No assignments on the ${departmentLabel} desk yet. Use “Assign task” to create the first one.`}
            </div>
          ) : null}

          {!loading && !error && tasks.length > 0 ? (
            <div className="mg-tk-board">
              {TASK_COLUMNS.map((column) => {
                const rows = board[column.id];
                const dropping = overColumn === column.id && dragId !== null;
                return (
                  <div
                    key={column.id}
                    className="mg-tk-col"
                    style={{ ['--tk-col' as string]: column.tone }}
                  >
                    <div className="mg-tk-col-head">
                      <div>
                        <div className="mg-tk-col-title">
                          <span className="mg-tk-col-dot" />
                          {column.label}
                        </div>
                        <div className="mg-tk-col-hint">{column.hint}</div>
                      </div>
                      {/* The count of what is ON this column, not the desk-wide figure: the metric
                          strip above owns the all-tasks numbers and says so. A header that prints
                          the desk total over a filtered body reads as a bug. */}
                      <div className="mg-tk-col-count">{rows.length}</div>
                    </div>
                    <div
                      className={`mg-tk-col-body${dropping ? ' is-drop' : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        if (overColumn !== column.id) setOverColumn(column.id);
                      }}
                      onDragLeave={() => {
                        if (overColumn === column.id) setOverColumn(null);
                      }}
                      onDrop={(event) => onDrop(column.id, event)}
                    >
                      {rows.map((task) => {
                        const late = isOverdue(task);
                        return (
                          <button
                            key={task.id}
                            type="button"
                            draggable={!saving}
                            className={`mg-tk-card${dragId === task.id ? ' is-dragging' : ''}${late ? ' is-overdue' : ''}`}
                            style={{ ['--tk-rail' as string]: late ? 'var(--danger)' : priorityTone(task.priority) }}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(MIME, task.id);
                              event.dataTransfer.setData('text/plain', task.id);
                              event.dataTransfer.effectAllowed = 'move';
                              setDragId(task.id);
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setOverColumn(null);
                            }}
                            onClick={() => setSelectedId(task.id)}
                          >
                            <div className="mg-tk-card-top">
                              <strong>{task.subject}</strong>
                              <span
                                className="mg-tk-pill"
                                style={{ ['--tk-pill' as string]: priorityTone(task.priority) }}
                              >
                                {task.priority}
                              </span>
                            </div>
                            <div className="mg-tk-card-who">{workerName(task.assigneeZohoUserId)}</div>
                            <div className="mg-tk-card-meta">
                              <span>{friendly(task.taskType)}</span>
                              <span className={late ? 'is-bad' : ''}>
                                {deadlineLabel(task.deadlineAt)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      {rows.length === 0 ? (
                        <div className="mg-tk-col-empty">Drop a card here</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {total > tasks.length ? (
            <p className="mg-empty-sm">
              Showing the {tasks.length} most recent of {total}. Narrow with the filters above to
              reach the rest.
            </p>
          ) : null}

      {assignOpen ? (
        <TaskAssignModal
          departmentLabel={departmentLabel}
          workers={workers}
          types={types}
          saving={saving}
          error={actionError}
          onSubmit={assign}
          onClose={() => {
            setAssignOpen(false);
            setActionError(null);
          }}
        />
      ) : null}

      {selected ? (
        <TaskDetailModal
          task={selected}
          events={events}
          eventsLoading={eventsLoading}
          workers={workers}
          saving={saving}
          error={actionError}
          onMove={(status) => void patch(selected, { status })}
          onReassign={(zohoUserId) => void patch(selected, { assigneeZohoUserId: zohoUserId })}
          onClose={() => {
            setSelectedId(null);
            setActionError(null);
          }}
        />
      ) : null}
    </section>
  );
}
