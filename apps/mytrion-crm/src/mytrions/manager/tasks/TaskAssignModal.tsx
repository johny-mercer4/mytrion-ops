/**
 * Assign a task — the Manager's create form, as a dialog.
 *
 * It was an always-visible column of the board, which cost a third of the width permanently to
 * something used a few times a day, and put an empty form next to the backlog it was meant to be
 * read against. As a dialog the board keeps the full width and the form gets room to be legible.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X } from 'lucide-react';
import type { TaskTypeDto, WorkerTaskPriority } from '../../../api/salesKpi';
import type { ManagerAssigneeDto } from '../../../api/managerTasks';
import { PRIORITIES, deadlineToIso } from './taskModel';

export interface TaskDraft {
  assigneeZohoUserId: string;
  type: string;
  subject: string;
  description?: string;
  deadlineAt?: string;
  priority: WorkerTaskPriority;
}

export function TaskAssignModal({
  departmentLabel,
  workers,
  types,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  departmentLabel: string;
  workers: readonly ManagerAssigneeDto[];
  types: readonly TaskTypeDto[];
  saving: boolean;
  error: string | null;
  onSubmit: (draft: TaskDraft) => void | Promise<void>;
  onClose: () => void;
}) {
  const [assignee, setAssignee] = useState(workers[0]?.zohoUserId ?? '');
  const [type, setType] = useState(types[0]?.code ?? 'general');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState<WorkerTaskPriority>('normal');
  const subjectRef = useRef<HTMLInputElement>(null);

  // The roster and catalog arrive after the first paint on a cold open, so seed the selects once
  // they land rather than leaving the dialog on an empty value the user has to notice and fix.
  useEffect(() => {
    if (!assignee && workers[0]) setAssignee(workers[0].zohoUserId);
  }, [assignee, workers]);
  useEffect(() => {
    if (types.length && !types.some((item) => item.code === type)) {
      setType(types[0]?.code ?? 'general');
    }
  }, [type, types]);

  useEffect(() => {
    subjectRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ready = Boolean(assignee) && subject.trim().length > 0 && !saving;

  return createPortal(
    <div className="mg-root mg-lty" data-mytrion="manager">
      <div className="mg-lty-modal-scrim" role="presentation" onMouseDown={onClose}>
        <div
          className="mg-lty-modal mg-tk-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={`Assign a ${departmentLabel} task`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="mg-lty-modal-head">
            <div>
              <span>Assign · {departmentLabel}</span>
              <h2>New assignment</h2>
            </div>
            <button type="button" className="mg-backbtn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </header>

          <form
            className="mg-tk-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!ready) return;
              const iso = deadlineToIso(deadline);
              void onSubmit({
                assigneeZohoUserId: assignee,
                type,
                subject: subject.trim(),
                ...(description.trim() ? { description: description.trim() } : {}),
                ...(iso ? { deadlineAt: iso } : {}),
                priority,
              });
            }}
          >
            {error ? <div className="mg-tk-error">{error}</div> : null}

            <label className="mg-tk-field">
              <span>Subject</span>
              <input
                ref={subjectRef}
                required
                maxLength={200}
                value={subject}
                placeholder="What needs doing?"
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>

            <div className="mg-tk-field-row">
              <label className="mg-tk-field">
                <span>Assign to</span>
                <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                  {workers.length === 0 ? <option value="">No eligible agents</option> : null}
                  {workers.map((worker) => (
                    <option key={worker.zohoUserId} value={worker.zohoUserId}>
                      {worker.displayName ?? worker.email ?? worker.zohoUserId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mg-tk-field">
                <span>Type</span>
                <select value={type} onChange={(event) => setType(event.target.value)}>
                  {types.map((item) => (
                    <option key={item.id} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mg-tk-field-row">
              <label className="mg-tk-field">
                <span>Priority</span>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as WorkerTaskPriority)}
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {value[0]?.toUpperCase()}
                      {value.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mg-tk-field">
                <span>
                  Deadline <em>optional</em>
                </span>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </label>
            </div>

            <label className="mg-tk-field">
              <span>
                Description <em>optional</em>
              </span>
              <textarea
                rows={5}
                maxLength={10_000}
                value={description}
                placeholder="Context, links, what done looks like…"
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <footer className="mg-tk-form-foot">
              <button type="button" className="mg-btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="mg-btn-primary" disabled={!ready}>
                <Send size={15} />
                {saving ? 'Assigning…' : 'Assign task'}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
