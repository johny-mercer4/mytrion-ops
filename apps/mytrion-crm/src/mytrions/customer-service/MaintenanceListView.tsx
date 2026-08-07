/**
 * Maintenance — List view (CS feedback 2026-08-07: "the list view we had before was much easier to
 * scan than this card grid"). A plain table over the same page of rows the card grid renders — same
 * data, same onOpen, just a denser layout for scanning many cases at once.
 */
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
            return (
              <tr key={row.id} className="cs-mt-list-row" onClick={() => onOpen(row)}>
                <td className="cs-mt-list-company" title={maintenanceTitle(row)}>
                  {maintenanceTitle(row)}
                </td>
                <td className="cs-mt-list-mono">{dash(row.carrierId)}</td>
                <td className="cs-mt-list-mono">{dash(row.unitNumber)}</td>
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
                <td className="cs-mt-list-amount">{fmtMoneyStr(row.totalAmount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
