/**
 * Timeline tab — the CRM's Timeline History logs every field change; the Postgres-backed
 * Maintenance case didn't have one (CS feedback 2026-07-31). Newest first, one entry per save.
 */
import { useEffect, useState } from 'react';

import { listMaintenanceHistory, type MaintenanceHistoryEntry } from '@/api/cs';

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {rows.map((entry) => (
        <div
          key={entry.id}
          style={{ borderLeft: '2px solid var(--check-border)', paddingLeft: '0.9rem' }}
        >
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {fmtWhen(entry.changedAt)} · {entry.changedByName || 'Unknown'}
          </div>
          {entry.action === 'created' ? (
            <div style={{ fontWeight: 600, marginTop: '0.2rem' }}>Maintenance Case Created</div>
          ) : null}
          {entry.changes.map((c) => (
            <div key={c.field} style={{ marginTop: '0.2rem' }}>
              <strong>{c.label}</strong> was updated from{' '}
              <em>{c.from ?? 'blank value'}</em> to <em>{c.to ?? 'blank value'}</em>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
