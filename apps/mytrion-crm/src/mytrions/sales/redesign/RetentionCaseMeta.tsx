/** Shared meta grid + timeline for the retention case modal. */
import type { RetentionCaseEventRow } from '@/api/touchpointTypes';
import { s } from './dc';
import { Icon } from './icons';
import {
  cadenceExplain,
  channelLabel,
  deadlineCaption,
  freqLabel,
  isOverdue,
  quietCaption,
  statusLabel,
  type RetentionCaseRow,
} from './retentionData';

export function RetentionCaseHeader(props: {
  loading: boolean;
  companyName: string;
  carrierId: string;
  phoneDisplay: string;
  onClose: () => void;
}) {
  return (
    <div
      style={s(
        'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0',
      )}
    >
      <div style={s('min-width:0;flex:1')}>
        {props.loading ? (
          <>
            <div className="ss-skel" style={s('height:18px;width:55%;margin-bottom:8px')} />
            <div className="ss-skel" style={s('height:12px;width:30%')} />
          </>
        ) : (
          <>
            <div
              style={s(
                'font-family:Rajdhani,sans-serif;font-weight:700;font-size:18px;letter-spacing:.04em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
              )}
            >
              {props.companyName}
            </div>
            <div style={s('display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-top:4px')}>
              <span style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace")}>
                {props.carrierId}
              </span>
              {props.phoneDisplay ? (
                <span
                  style={s(
                    "font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;letter-spacing:.03em;color:var(--accent-text)",
                  )}
                >
                  {props.phoneDisplay}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={props.onClose}
        className="ss-ico-btn"
        aria-label="Close"
        style={s(
          'width:34px;height:34px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0',
        )}
      >
        <Icon name="close" size={15} strokeWidth={2.4} />
      </button>
    </div>
  );
}

export function RetentionDetailSkeleton() {
  return (
    <div style={s('display:flex;flex-direction:column;gap:12px')} aria-hidden="true">
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="ss-skel" style={s('height:58px;border-radius:var(--radius-md)')} />
        ))}
      </div>
      <div className="ss-skel" style={s('height:72px;border-radius:var(--radius-md)')} />
      <div className="ss-skel" style={s('height:120px;border-radius:var(--radius-md)')} />
    </div>
  );
}

export function RetentionMetaGrid({ row }: { row: RetentionCaseRow }) {
  const overdue = isOverdue(row);
  const cells: [string, string, string?][] = [
    ['Status', statusLabel(row.statusCode)],
    ['Frequency', freqLabel(row.transactionFrequency), cadenceExplain(row.transactionFrequency)],
    ['Inactivity', quietCaption(row)],
    ['Deadline', deadlineCaption(row)],
    ['90d gallons', row.gallons90d != null ? Math.round(row.gallons90d).toLocaleString() : '—'],
    ['Attempts', `${row.outOfReachAttempts}/5`],
    ['Assignment', String(row.assignmentCount)],
    ['Agent', row.agentName || '—'],
  ];
  return (
    <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
      {cells.map(([label, value, hint]) => (
        <div
          key={label}
          style={s(
            'padding:10px 12px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border)',
          )}
          title={hint}
        >
          <div
            style={s(
              'font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)',
            )}
          >
            {label}
          </div>
          <div
            style={s(
              `font-size:13px;font-weight:700;margin-top:4px;color:${label === 'Deadline' && overdue ? 'var(--danger)' : 'var(--text)'}`,
            )}
          >
            {value}
          </div>
          {hint ? (
            <div style={s('font-size:10px;color:var(--faint);margin-top:3px;line-height:1.3')}>{hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function eventKindLabel(ev: RetentionCaseEventRow): string {
  switch (ev.eventType) {
    case 'comms_attempt':
      return 'Attempt';
    case 'outcome_recorded':
      return 'Stage';
    case 'created':
      return 'Created';
    case 'timer_expired':
      return 'Timer';
    case 'reassigned':
      return 'Reassigned';
    default:
      return ev.eventType.replace(/_/g, ' ');
  }
}

function eventHeadline(ev: RetentionCaseEventRow): string {
  const to = statusLabel(ev.toStatus);
  if (ev.eventType === 'comms_attempt') {
    const ch = channelLabel(ev.channel);
    return `${ch} attempt → ${to}`;
  }
  if (ev.fromStatus) return `${statusLabel(ev.fromStatus)} → ${to}`;
  return to;
}

export function RetentionEventTrail({ events }: { events: RetentionCaseEventRow[] }) {
  if (events.length === 0) {
    return <div style={s('font-size:12px;color:var(--muted)')}>No events yet.</div>;
  }
  return (
    <div>
      <div
        style={s(
          'font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:8px',
        )}
      >
        Timeline
      </div>
      <div style={s('display:flex;flex-direction:column;gap:8px')}>
        {events.map((ev) => (
          <div
            key={ev.id}
            style={s(
              'padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--surface)',
            )}
          >
            <div style={s('display:flex;justify-content:space-between;gap:8px;font-size:11px')}>
              <span style={s('font-weight:700;color:var(--accent)')}>{eventKindLabel(ev)}</span>
              <span style={s('color:var(--muted)')}>
                {new Date(ev.occurredAt).toLocaleString()}
              </span>
            </div>
            <div style={s('font-size:13px;font-weight:700;color:var(--text);margin-top:5px')}>
              {eventHeadline(ev)}
            </div>
            {ev.notes && (
              <div style={s('font-size:12px;color:var(--muted);margin-top:4px;line-height:1.4')}>
                {ev.notes}
              </div>
            )}
            {ev.evidenceUrl && (
              <a
                href={ev.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                style={s('display:inline-block;margin-top:8px')}
              >
                <img
                  src={ev.evidenceUrl}
                  alt="Attempt evidence"
                  style={s(
                    'max-width:100%;max-height:140px;border-radius:8px;border:1px solid var(--border);object-fit:contain;background:var(--alt)',
                  )}
                />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
