/**
 * Timeline tab — the CRM's Timeline History logs every field change; the Postgres-backed
 * Maintenance case didn't have one (CS feedback 2026-07-31).
 *
 * One row per FIELD change, not per save (CS feedback 2026-08-07: Zoho logs each field change as
 * its own entry with its own timestamp/editor, which makes it easy to trace a specific edit; the
 * old rendering here lumped every field a save touched under one shared header, which read as a
 * wall of text). The backend already stores per-field granularity — `entry.changes` is an array of
 * discrete `{field,label,from,to}` objects (see maintenanceFields.ts's `diffMaintenanceCase`) — this
 * was purely a rendering choice, so the fix is flattening that array into independent rows here
 * rather than changing what's stored. Rows from the same save legitimately share one timestamp,
 * same as Zoho's own reference screenshot (several rows all reading the same minute).
 */
import { useEffect, useState } from 'react';

import { listMaintenanceHistory, type MaintenanceHistoryChange, type MaintenanceHistoryEntry } from '@/api/cs';

/** Same tone map the card uses for these two fields (MaintenanceCard.tsx) — a status change should
 *  read the same color here as it does on the card. */
const STATUS_BADGE: Record<string, string> = {
  'In Process': 'cs-badge-warning',
  Completed: 'cs-badge-success',
  Cancelled: 'cs-badge-muted',
};
const PAY_BADGE: Record<string, string> = {
  Paid: 'cs-badge-success',
  Pending: 'cs-badge-warning',
  'Not Paid': 'cs-badge-danger',
  Delay: 'cs-badge-orange',
  'N/A': 'cs-badge-muted',
};
const BADGE_FIELDS: Record<string, Record<string, string>> = {
  status: STATUS_BADGE,
  paymentStatus: PAY_BADGE,
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One independently-rendered line — either the case-created marker or a single field change. */
interface FlatRow {
  key: string;
  changedAt: string;
  changedByName: string | null;
  created: boolean;
  change: MaintenanceHistoryChange | null;
}

function flatten(entries: MaintenanceHistoryEntry[]): FlatRow[] {
  const out: FlatRow[] = [];
  for (const entry of entries) {
    if (entry.action === 'created') {
      out.push({
        key: `${entry.id}-created`,
        changedAt: entry.changedAt,
        changedByName: entry.changedByName,
        created: true,
        change: null,
      });
    }
    for (const c of entry.changes) {
      out.push({
        key: `${entry.id}-${c.field}`,
        changedAt: entry.changedAt,
        changedByName: entry.changedByName,
        created: false,
        change: c,
      });
    }
  }
  return out;
}

function ChangeValue({ field, value }: { field: string; value: string | null }) {
  const badge = value ? BADGE_FIELDS[field]?.[value] : undefined;
  if (badge) return <span className={`cs-badge cs-badge-sm ${badge}`}>{value}</span>;
  return <em>{value ?? 'blank value'}</em>;
}

export function MaintenanceTimeline({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<MaintenanceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    listMaintenanceHistory(caseId)
      .then((r) => setRows(r.history))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, [caseId]);

  if (loading) return <div className="cs-home-empty">Loading…</div>;
  if (error) return <div className="cs-form-error">{error}</div>;
  if (rows.length === 0) return <div className="cs-home-empty">No history yet</div>;

  const flat = flatten(rows);

  return (
    <div className="cs-mt-tl">
      {flat.map((row) => (
        <div key={row.key} className="cs-mt-tl-row">
          <span className="cs-mt-tl-dot" aria-hidden="true" />
          <div className="cs-mt-tl-body">
            <div className="cs-mt-tl-meta">
              {fmtWhen(row.changedAt)} · {row.changedByName || 'Unknown'}
            </div>
            {row.created ? (
              <div className="cs-mt-tl-text cs-mt-tl-created">Maintenance Case Created</div>
            ) : row.change ? (
              <div className="cs-mt-tl-text">
                <strong>{row.change.label}</strong> was updated from{' '}
                <ChangeValue field={row.change.field} value={row.change.from} /> to{' '}
                <ChangeValue field={row.change.field} value={row.change.to} />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
