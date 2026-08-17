/**
 * Open Pool record body for the DataTable phone sheet. Desktop keeps the sticky aside;
 * on a phone there is no "beside", so Gallons / Cycle / Window / timeline live here.
 */
import { useEffect, useState } from 'react';
import { CalendarClock, Clock3, Droplets, Hash } from 'lucide-react';
import type { RetentionCaseEventRow, RetentionCaseRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { CaseBadge, deadlineLabel, statusLabel, statusTone } from './casesUi';

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtGal(v: number | null | undefined): string {
  return v == null ? '—' : Math.round(v).toLocaleString('en-US');
}

function quietLabel(c: RetentionCaseRow): string {
  return c.daysInactive == null ? '—' : `${c.daysInactive}d`;
}

export function OpenPoolCaseSheet({ row }: { row: RetentionCaseRow }) {
  const [events, setEvents] = useState<RetentionCaseEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void csRetention
      .caseGet(row.id)
      .then((res) => {
        if (!cancelled) setEvents(res.events ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setEvents([]);
          setError(e instanceof Error ? e.message : 'Failed to load timeline');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <div className="cs-pool-drawer-body">
      <div className="cs-pool-drawer-head">
        <div className="cs-pool-drawer-badges">
          <CaseBadge tone={statusTone(row.statusCode)}>{statusLabel(row.statusCode)}</CaseBadge>
          <CaseBadge tone="info">{`Cycle ${row.assignmentCount}/3`}</CaseBadge>
        </div>
        <dl className="cs-pool-drawer-meta">
          <div>
            <dt>
              <Hash size={11} strokeWidth={2.4} aria-hidden />
              Carrier
            </dt>
            <dd className="cs-pool-mono">{row.carrierId}</dd>
          </div>
          <div>
            <dt>
              <Clock3 size={11} strokeWidth={2.4} aria-hidden />
              Quiet
            </dt>
            <dd>{quietLabel(row)}</dd>
          </div>
          <div>
            <dt>
              <Droplets size={11} strokeWidth={2.4} aria-hidden />
              Gallons 90d
            </dt>
            <dd className="cs-pool-mono">{fmtGal(row.gallons90d)}</dd>
          </div>
          <div>
            <dt>
              <CalendarClock size={11} strokeWidth={2.4} aria-hidden />
              Window
            </dt>
            <dd>{deadlineLabel(row)}</dd>
          </div>
        </dl>
      </div>

      <div className="cs-pool-drawer-section">
        <div className="cs-ret-section-lbl">Timeline</div>
        {loading ? (
          <div className="cs-pool-skel" aria-busy="true" aria-label="Loading timeline">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="cs-pool-skel-row">
                <div className="cs-skeleton cs-pool-skel-cell w-30" />
                <div className="cs-skeleton cs-pool-skel-cell w-70" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="cs-error">{error}</p>
        ) : events.length === 0 ? (
          <p className="cs-muted">No events yet.</p>
        ) : (
          <ul className="cs-pool-timeline">
            {events.map((ev) => (
              <li key={ev.id}>
                <div className="cs-pool-timeline-when">
                  {fmtWhen(ev.occurredAt)} · {ev.eventType}
                </div>
                <div className="cs-pool-timeline-note">
                  {ev.notes?.trim() || `${ev.fromStatus ?? '—'} → ${ev.toStatus ?? '—'}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
