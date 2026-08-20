/**
 * Follow-ups on this case — the Tasks related list, which the desk had no equivalent for.
 *
 * NOT the same thing as the Today worklist. The worklist decides what needs attention from policy
 * and case state; this is the reminder a collector sets for themselves: "call the court clerk
 * Thursday". Nobody can derive that, so it has to be typed, and it has to be editable — which is
 * why it is its own table rather than another timeline entry.
 *
 * Overdue is stated in days, not just coloured: "4 days late" is actionable where a red dot is a
 * thing you have to hover to understand.
 */
import { useState } from 'react';
import { Badge, Button, DateField, Input, Select, useToast } from '@/ds';
import {
  createCaseTask,
  updateCaseTask,
  type CollectionTask,
  type CollectionTaskPriority,
} from '@/api/collectionDesk';
import { fmtDate } from '../../collectionFormat';
import { todayIso } from '../../actions/actionsModel';

const PRIORITIES: CollectionTaskPriority[] = ['low', 'normal', 'high'];

/** "in 3 days" / "4 days late" / "today". A count nobody has to decode. */
export function dueCopy(task: CollectionTask): string {
  if (task.status !== 'open') return fmtDate(task.dueDate);
  const late = task.daysLate ?? 0;
  if (late === 0) return 'Due today';
  if (late < 0) return `Due in ${-late} day${late === -1 ? '' : 's'}`;
  return `${late} day${late === 1 ? '' : 's'} late`;
}

export function CaseTasks({
  caseId,
  tasks,
  readOnly,
  onChanged,
}: {
  caseId: string;
  tasks: CollectionTask[];
  /** A closed case keeps its follow-ups readable but stops accepting new ones. */
  readOnly: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(todayIso());
  const [priority, setPriority] = useState<CollectionTaskPriority>('normal');
  const [busy, setBusy] = useState(false);

  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status !== 'open');

  const add = async (): Promise<void> => {
    if (!title.trim() || !dueDate) return;
    setBusy(true);
    try {
      await createCaseTask(caseId, { title: title.trim(), dueDate, priority });
      toast({ intent: 'success', title: 'Follow-up set' });
      setTitle('');
      setDueDate(todayIso());
      setPriority('normal');
      setAdding(false);
      onChanged();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not set the follow-up', description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (task: CollectionTask, status: 'done' | 'cancelled' | 'open'): Promise<void> => {
    setBusy(true);
    try {
      await updateCaseTask(task.id, { status });
      onChanged();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not update the follow-up', description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cc-pane ct-pane">
      <header className="cc-pane-head">
        <h2 className="cc-pane-title">Follow-ups</h2>
        <span className="cc-pane-meta">
          {open.length === 0 ? 'Nothing scheduled' : `${open.length} open`}
        </span>
        {!readOnly && !adding ? (
          <Button variant="secondary" size="sm" icon="add" onClick={() => setAdding(true)}>
            Add
          </Button>
        ) : null}
      </header>

      {adding ? (
        <div className="ct-add">
          <Input
            fullWidth
            autoFocus
            placeholder="What needs doing?"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          <DateField value={dueDate} onChange={setDueDate} />
          <Select
            label="Priority"
            size="sm"
            value={priority}
            onChange={(v) => setPriority((v as CollectionTaskPriority | null) ?? 'normal')}
            options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
          <span className="ct-add-actions">
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={busy || !title.trim() || !dueDate}
              onClick={() => void add()}
            >
              Set
            </Button>
          </span>
        </div>
      ) : null}

      {/* No empty state: the header already says "Nothing scheduled". This panel sits at the top of
          the record, and five lines of chrome telling you there is nothing here pushed the timeline
          — the thing you opened the case to read — below the fold. */}

      <ul className="ct-list">
        {[...open, ...done].map((task) => (
          <li key={task.id} className="ct-row" data-status={task.status}>
            <span className="ct-row-main">
              <span className="ct-row-title">{task.title}</span>
              <span className="ct-row-meta">
                {dueCopy(task)}
                {task.assigneeName ? ` · ${task.assigneeName}` : ''}
              </span>
            </span>
            {task.priority !== 'normal' && task.status === 'open' ? (
              <Badge size="sm" intent={task.priority === 'high' ? 'warning' : 'neutral'}>
                {task.priority}
              </Badge>
            ) : null}
            {(task.daysLate ?? 0) > 0 && task.status === 'open' ? (
              <Badge size="sm" intent="danger" icon="warning">
                Late
              </Badge>
            ) : null}
            {readOnly ? null : task.status === 'open' ? (
              <span className="ct-row-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  icon="check"
                  disabled={busy}
                  onClick={() => void resolve(task, 'done')}
                >
                  Done
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="close"
                  disabled={busy}
                  onClick={() => void resolve(task, 'cancelled')}
                >
                  Drop
                </Button>
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void resolve(task, 'open')}
              >
                Reopen
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
