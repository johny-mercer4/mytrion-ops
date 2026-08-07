/**
 * Maintenance — Kanban view (CS feedback 2026-08-07, the "ideally Kanban too" ask). Static columns
 * grouped by status over the same page of rows the other views render — not drag-and-drop: moving a
 * case between columns would mean writing a status change, which is a bigger, separate feature this
 * request didn't ask for. This is a read-only alternate layout, same as List/Card.
 */
import { fmtMoneyStr, maintenanceTitle, type MaintenanceRecord } from './live';

const dash = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

function groupByStatus(
  rows: MaintenanceRecord[],
  canonicalOrder: string[],
): Array<{ status: string; rows: MaintenanceRecord[] }> {
  const byStatus = new Map<string, MaintenanceRecord[]>();
  for (const row of rows) {
    const key = row.status?.trim() || 'Other';
    const bucket = byStatus.get(key);
    if (bucket) bucket.push(row);
    else byStatus.set(key, [row]);
  }
  const seen = new Set(canonicalOrder);
  const extra = [...byStatus.keys()].filter((k) => !seen.has(k));
  return [...canonicalOrder, ...extra].filter((s) => byStatus.has(s)).map((status) => ({
    status,
    rows: byStatus.get(status) ?? [],
  }));
}

export function MaintenanceKanbanView({
  rows,
  statusOptions,
  onOpen,
}: {
  rows: MaintenanceRecord[];
  statusOptions: string[];
  onOpen: (row: MaintenanceRecord) => void;
}) {
  const columns = groupByStatus(rows, statusOptions);

  return (
    <div className="cs-mt-kanban">
      {columns.map((col) => (
        <div key={col.status} className="cs-mt-kanban-col">
          <div className="cs-mt-kanban-col-head">
            <span>{col.status}</span>
            <span className="cs-mt-kanban-col-count">{col.rows.length}</span>
          </div>
          <div className="cs-mt-kanban-col-body">
            {col.rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="cs-mt-kanban-card"
                onClick={() => onOpen(row)}
                aria-label={`Open maintenance case for ${maintenanceTitle(row)}`}
              >
                <div className="cs-mt-kanban-card-company" title={maintenanceTitle(row)}>
                  {maintenanceTitle(row)}
                </div>
                <div className="cs-mt-kanban-card-meta">
                  <span>{dash(row.carrierId)}</span>
                  <span className="cs-mt-kanban-card-amount">{fmtMoneyStr(row.totalAmount)}</span>
                </div>
                <div className="cs-mt-kanban-card-owner">{row.ownerName || 'Unassigned'}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
