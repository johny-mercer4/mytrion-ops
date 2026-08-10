/**
 * Maintenance — List view (CS feedback 2026-08-07: "the list view we had before was much easier to
 * scan than this card grid"). A plain table over the same page of rows the card grid renders — same
 * data, same onOpen, just a denser layout for scanning many cases at once.
 */
import type { MouseEvent } from 'react';
import { copyWithToast } from './copyToast';
import { fmtMoneyStr, fmtYmd, maintenanceTitle, type MaintenanceRecord } from './live';

/** Same tone maps the card uses (MaintenanceCard.tsx) — a status reads the same color everywhere. */
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

const dash = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

/** Stops the click from bubbling to the row's onOpen, and copies instead — QA feedback 2026-08-11:
 *  clicking Company/Carrier ID/Unit #/Amount opened the modal instead of copying. */
function copyCell(text: string, ev: MouseEvent<HTMLTableCellElement>): void {
  ev.stopPropagation();
  copyWithToast(text, ev);
}

/** className/title/onClick for a copyable cell, folding in `baseClass` — no pointer cursor or
 *  click handler at all when there's nothing on the row to copy. */
function copyableCell(
  baseClass: string,
  text: string,
  label: string,
): {
  className: string;
  title: string | undefined;
  onClick: ((e: MouseEvent<HTMLTableCellElement>) => void) | undefined;
} {
  if (!text) return { className: baseClass, title: undefined, onClick: undefined };
  return {
    className: `${baseClass} cs-mt-cell-copyable`,
    title: `Click to copy ${label}`,
    onClick: (e) => copyCell(text, e),
  };
}

export function MaintenanceListView({
  rows,
  onOpen,
}: {
  rows: MaintenanceRecord[];
  onOpen: (row: MaintenanceRecord) => void;
}) {
  return (
    <div className="cs-table-wrap cs-mt-list-wrap">
      <table className="cs-table cs-mt-list">
        <thead>
          <tr>
            <th>Company</th>
            <th>Carrier ID</th>
            <th>Unit #</th>
            <th>Status</th>
            <th>Case Type</th>
            <th>Date</th>
            <th>Completed</th>
            <th>Owner</th>
            <th>Payment</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = row.status ?? '';
            const payStatus = row.paymentStatus ?? '';
            const title = maintenanceTitle(row);
            const companyCell = copyableCell('cs-mt-list-company', title, 'Company');
            const carrierCell = copyableCell('cs-mt-list-mono', row.carrierId ?? '', 'Carrier ID');
            const unitCell = copyableCell('cs-mt-list-mono', row.unitNumber ?? '', 'Unit #');
            const amountCell = copyableCell(
              'cs-mt-list-amount',
              row.totalAmount ? fmtMoneyStr(row.totalAmount) : '',
              'Amount',
            );
            return (
              <tr key={row.id} className="cs-mt-list-row" onClick={() => onOpen(row)}>
                <td {...companyCell}>{title}</td>
                <td {...carrierCell}>{dash(row.carrierId)}</td>
                <td {...unitCell}>{dash(row.unitNumber)}</td>
                <td>
                  <span className={`cs-badge cs-badge-sm ${STATUS_BADGE[status] ?? 'cs-badge-muted'}`}>
                    {status || '—'}
                  </span>
                </td>
                <td>{dash(row.caseType)}</td>
                <td className="cs-mt-list-mono">{fmtYmd(row.caseDate) || '—'}</td>
                <td className="cs-mt-list-mono">
                  {row.caseCompletion ? (
                    fmtYmd(row.caseCompletion)
                  ) : (
                    <span className="cs-mt-list-open">Not signed off</span>
                  )}
                </td>
                <td className="cs-mt-list-owner" title={row.ownerName ?? 'Unassigned'}>
                  {row.ownerName || 'Unassigned'}
                </td>
                <td>
                  {payStatus ? (
                    <span className={`cs-badge cs-badge-sm ${PAY_BADGE[payStatus] ?? 'cs-badge-muted'}`}>
                      {payStatus}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td {...amountCell}>{fmtMoneyStr(row.totalAmount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
