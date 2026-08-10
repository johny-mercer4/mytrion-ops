/**
 * Sales My Tasks detail — DetailSheet chrome (portal, accent rail, ESC/backdrop) + event history.
 */
import { useEffect, useState } from 'react';
import {
  listMyTaskEvents,
  type WorkerTaskDto,
  type WorkerTaskEventDto,
  type WorkerTaskStatus,
} from '@/api/salesKpi';
import { DetailSheet } from './dataCenterSheet';
import { s } from './dc';
import { Icon } from './icons';

const STATUS_TONE: Record<WorkerTaskStatus, string> = {
  open: 'var(--accent)',
  in_progress: 'var(--warn)',
  completed: 'var(--ok)',
  cancelled: 'var(--muted)',
};

function friendly(value: string): string {
  return value.replaceAll('_', ' ');
}

function deadlineLabel(value: string | null): string {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={s('padding:12px 14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
      <div style={s('font-size:var(--ss-text-badge);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
        {label}
      </div>
      <div style={s('margin-top:6px;font-size:var(--ss-text-sm);font-weight:650;color:var(--text);line-height:1.45;word-break:break-word')}>
        {value}
      </div>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={s(
        `display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:var(--radius-full);font-size:var(--ss-text-badge);font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${tone} 15%,transparent);border:1px solid color-mix(in srgb,${tone} 34%,transparent);color:${tone}`,
      )}
    >
      {text}
    </span>
  );
}

export function TaskDetailModal({
  task,
  moving,
  onClose,
  onMove,
}: {
  task: WorkerTaskDto;
  moving: boolean;
  onClose: () => void;
  onMove: (status: WorkerTaskStatus) => void;
}) {
  const accent = STATUS_TONE[task.status];
  const [events, setEvents] = useState<WorkerTaskEventDto[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    void listMyTaskEvents(task.id)
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
  }, [task.id, task.version]);

  const overdue =
    Boolean(task.deadlineAt) &&
    task.status !== 'completed' &&
    task.status !== 'cancelled' &&
    new Date(task.deadlineAt!).getTime() < Date.now();

  return (
    <DetailSheet
      accent={accent}
      ariaLabel={`Task — ${task.subject}`}
      title={task.subject}
      subtitle={`${friendly(task.taskType)} · ${friendly(task.priority)} priority`}
      avatar={
        <div
          style={s(
            `width:42px;height:42px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${accent} 15%,transparent);color:${accent}`,
          )}
        >
          <Icon name="clipboardCheck" size={20} strokeWidth={1.9} />
        </div>
      }
      badges={
        <div style={s('display:flex;gap:7px;flex-wrap:wrap')}>
          <Chip text={friendly(task.status)} tone={accent} />
          <Chip text={task.source} tone="var(--text2)" />
          {overdue ? <Chip text="Overdue" tone="var(--danger)" /> : null}
        </div>
      }
      onClose={onClose}
      saving={moving}
      footer={
        <div style={s('padding:12px 20px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px')}>
          {task.status === 'open' ? (
            <button
              type="button"
              disabled={moving}
              onClick={() => onMove('in_progress')}
              style={s(
                'height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent-text);font-weight:750;font-size:var(--ss-text-sm);cursor:pointer;font-family:inherit',
              )}
            >
              Start
            </button>
          ) : null}
          {task.status === 'open' || task.status === 'in_progress' ? (
            <button
              type="button"
              disabled={moving}
              onClick={() => onMove('completed')}
              style={s(
                'height:38px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(140deg,var(--ok),color-mix(in srgb,var(--ok) 70%,var(--accent)));color:#fff;font-weight:750;font-size:var(--ss-text-sm);cursor:pointer;font-family:inherit',
              )}
            >
              Complete
            </button>
          ) : null}
          {task.status === 'completed' || task.status === 'cancelled' ? (
            <button
              type="button"
              disabled={moving}
              onClick={() => onMove('open')}
              style={s(
                'height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:750;font-size:var(--ss-text-sm);cursor:pointer;font-family:inherit',
              )}
            >
              Reopen
            </button>
          ) : null}
          <button
            type="button"
            disabled={moving}
            onClick={onClose}
            style={s(
              'height:38px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:var(--ss-text-sm);cursor:pointer;font-family:inherit',
            )}
          >
            Close
          </button>
        </div>
      }
    >
      <div style={s('display:flex;flex-direction:column;gap:18px')}>
        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
          <Field label="Status" value={friendly(task.status)} />
          <Field label="Priority" value={friendly(task.priority)} />
          <Field label="Deadline" value={deadlineLabel(task.deadlineAt)} />
          <Field label="Type" value={friendly(task.taskType)} />
        </div>

        {task.description ? (
          <div>
            <div style={s('font-size:var(--ss-text-2xs);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px')}>
              Description
            </div>
            <p style={s('margin:0;padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-size:var(--ss-text-sm);line-height:1.55;white-space:pre-wrap')}>
              {task.description}
            </p>
          </div>
        ) : null}

        <div>
          <div style={s('font-size:var(--ss-text-2xs);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:10px')}>
            History
          </div>
          {eventsLoading ? (
            <div style={s('padding:16px;color:var(--muted);font-size:var(--ss-text-xs)')}>Loading history…</div>
          ) : events.length === 0 ? (
            <div style={s('padding:18px;border:1px dashed var(--border2);border-radius:var(--radius-md);color:var(--muted);font-size:var(--ss-text-xs)')}>
              No events yet.
            </div>
          ) : (
            <div style={s('display:flex;flex-direction:column;gap:8px')}>
              {events.map((event) => (
                <div
                  key={event.id}
                  style={s('padding:11px 13px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--alt)')}
                >
                  <div style={s('font-weight:750;font-size:var(--ss-text-xs);text-transform:capitalize')}>
                    {friendly(event.eventType)}
                    {event.fromStatus && event.toStatus
                      ? ` · ${friendly(event.fromStatus)} → ${friendly(event.toStatus)}`
                      : ''}
                  </div>
                  <div style={s('margin-top:3px;color:var(--muted);font-size:var(--ss-text-2xs)')}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DetailSheet>
  );
}
