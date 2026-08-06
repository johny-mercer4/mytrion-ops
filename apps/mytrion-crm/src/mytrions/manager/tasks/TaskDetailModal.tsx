/**
 * One assignment, in full: facts, the actions a manager has on it, and its event history.
 *
 * History is the reason this is a dialog rather than a third board column — an audit trail is
 * read occasionally and at length, which is the opposite of what a permanently-docked panel is
 * good for. Events come from `mytrion_worker_task_events`, newest first.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CircleSlash, Clock3, Flag, Play, RotateCcw, User, X } from 'lucide-react';
import type { WorkerTaskDto, WorkerTaskEventDto, WorkerTaskStatus } from '../../../api/salesKpi';
import type { ManagerAssigneeDto } from '../../../api/managerTasks';
import {
  deadlineLabel,
  friendly,
  isOverdue,
  priorityTone,
  statusLabel,
  timestampLabel,
} from './taskModel';

/** Status moves a manager may make from here. Mirrors the agent board's allowed transitions. */
function nextStates(status: WorkerTaskStatus): Array<{
  to: WorkerTaskStatus;
  label: string;
  icon: typeof Play;
  danger?: boolean;
}> {
  if (status === 'completed' || status === 'cancelled') {
    return [{ to: 'open', label: 'Reopen', icon: RotateCcw }];
  }
  const moves: Array<{ to: WorkerTaskStatus; label: string; icon: typeof Play; danger?: boolean }> =
    [];
  if (status === 'open') moves.push({ to: 'in_progress', label: 'Start', icon: Play });
  moves.push({ to: 'completed', label: 'Complete', icon: Flag });
  moves.push({ to: 'cancelled', label: 'Cancel', icon: CircleSlash, danger: true });
  return moves;
}

export function TaskDetailModal({
  task,
  events,
  eventsLoading,
  workers,
  saving,
  error,
  onMove,
  onReassign,
  onClose,
}: {
  task: WorkerTaskDto;
  events: readonly WorkerTaskEventDto[];
  eventsLoading: boolean;
  workers: readonly ManagerAssigneeDto[];
  saving: boolean;
  error: string | null;
  onMove: (status: WorkerTaskStatus) => void;
  onReassign: (zohoUserId: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const overdue = isOverdue(task);
  const assigneeName =
    workers.find((worker) => worker.zohoUserId === task.assigneeZohoUserId)?.displayName ??
    task.assigneeZohoUserId;

  return createPortal(
    <div className="mg-root mg-lty" data-mytrion="manager">
      <div className="mg-lty-modal-scrim" role="presentation" onMouseDown={onClose}>
        <div
          className="mg-lty-modal mg-tk-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={task.subject}
          onMouseDown={(event) => event.stopPropagation()}
          style={{ ['--mg-tone' as string]: priorityTone(task.priority) }}
        >
          <header className="mg-lty-modal-head">
            <div>
              <span>
                {friendly(task.taskType)} · {task.source}
              </span>
              <h2>{task.subject}</h2>
            </div>
            <button type="button" className="mg-backbtn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </header>

          <div className="mg-tk-dialog-body">
            {error ? <div className="mg-tk-error">{error}</div> : null}

            <dl className="mg-tk-facts">
              <div>
                <dt>Status</dt>
                <dd>{statusLabel(task.status)}</dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd style={{ color: priorityTone(task.priority) }}>{task.priority}</dd>
              </div>
              <div>
                <dt>Assignee</dt>
                <dd>{assigneeName}</dd>
              </div>
              <div className={overdue ? 'is-overdue' : ''}>
                <dt>Deadline</dt>
                <dd>
                  <Clock3 size={12} aria-hidden /> {deadlineLabel(task.deadlineAt)}
                  {overdue ? ' · overdue' : ''}
                </dd>
              </div>
            </dl>

            <section className="mg-tk-dialog-section">
              <h3 className="mg-section-label">Description</h3>
              <p className="mg-tk-desc">{task.description || 'No description was provided.'}</p>
            </section>

            <section className="mg-tk-dialog-section">
              <h3 className="mg-section-label">Actions</h3>
              <div className="mg-tk-actions">
                <label className="mg-tk-reassign">
                  <User size={14} aria-hidden />
                  <select
                    aria-label={`Reassign ${task.subject}`}
                    value={task.assigneeZohoUserId}
                    disabled={saving}
                    onChange={(event) => onReassign(event.target.value)}
                  >
                    {workers.length === 0 ? (
                      <option value={task.assigneeZohoUserId}>{assigneeName}</option>
                    ) : null}
                    {workers.map((worker) => (
                      <option key={worker.zohoUserId} value={worker.zohoUserId}>
                        {worker.displayName ?? worker.zohoUserId}
                      </option>
                    ))}
                  </select>
                </label>
                {nextStates(task.status).map((move) => {
                  const MoveIcon = move.icon;
                  return (
                    <button
                      key={move.to}
                      type="button"
                      className={`mg-btn${move.danger ? ' is-danger' : ''}`}
                      disabled={saving}
                      onClick={() => onMove(move.to)}
                    >
                      <MoveIcon size={14} />
                      {move.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="mg-tk-dialog-section">
              <h3 className="mg-section-label">History</h3>
              {eventsLoading ? (
                <div className="mg-tk-history-skeleton" aria-busy="true" aria-label="Loading history">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`mg-sk mg-sk-line${i ? ` mg-sk-d${i as 1 | 2}` : ''}`}
                      style={{ width: `${72 - i * 14}%`, height: 12 }}
                    />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <p className="mg-tk-desc">No events recorded yet.</p>
              ) : (
                <ul className="mg-tk-timeline">
                  {[...events].reverse().map((event) => (
                    <li key={event.id}>
                      <strong>{friendly(event.eventType)}</strong>
                      <span>
                        {event.fromStatus && event.toStatus
                          ? `${friendly(event.fromStatus)} → ${friendly(event.toStatus)} · `
                          : ''}
                        {timestampLabel(event.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
