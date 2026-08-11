import { s } from './dc';
import { nyToday } from './salesData';
import { TXN_RANGE_PRESETS } from './txnReport';
import { AUTO_INPUT } from './autoControls';

const labelCss = 'font-size:var(--ss-text-2xs);font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const invoiceRanges = ['Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Custom Range'];
const invoiceStatuses = [
  { value: 'all', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PARTIALLY_PAID', label: 'Partially Paid' },
  { value: 'PAID', label: 'Paid' },
];

function Label({ children }: { children: string }) {
  return <div style={s(labelCss)}>{children}</div>;
}

export interface AutoReportFiltersProps {
  kind: string | undefined;
  invoice: {
    range: string;
    status: string;
    from: string;
    to: string;
    onRange: (value: string) => void;
    onStatus: (value: string) => void;
    onFrom: (value: string) => void;
    onTo: (value: string) => void;
  };
  transactions: {
    range: string;
    from: string;
    to: string;
    onRange: (value: string) => void;
    onFrom: (value: string) => void;
    onTo: (value: string) => void;
  };
}

export function AutoReportFilters({ kind, invoice, transactions }: AutoReportFiltersProps) {
  if (kind === 'invoices') {
    return (
      <div style={s('display:flex;flex-direction:column;gap:12px')}>
        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
          <div>
            <Label>Quick Date Range</Label>
            <select value={invoice.range} onChange={(e) => invoice.onRange(e.target.value)} className="ss-in" style={s(AUTO_INPUT)}>
              {invoiceRanges.map((range) => <option key={range}>{range}</option>)}
            </select>
          </div>
          <div>
            <Label>Status</Label>
            <select value={invoice.status} onChange={(e) => invoice.onStatus(e.target.value)} className="ss-in" style={s(AUTO_INPUT)}>
              {invoiceStatuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
        {invoice.range === 'Custom Range' && (
          <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
            <div><Label>Start Date</Label><input type="date" value={invoice.from} onChange={(e) => invoice.onFrom(e.target.value)} className="ss-in" style={s(AUTO_INPUT)} /></div>
            <div><Label>End Date</Label><input type="date" value={invoice.to} min={invoice.from} max={nyToday()} onChange={(e) => invoice.onTo(e.target.value)} className="ss-in" style={s(AUTO_INPUT)} /></div>
          </div>
        )}
      </div>
    );
  }

  if (kind !== 'transactions') return null;
  return (
    <div style={s('display:flex;flex-direction:column;gap:12px')}>
      <div>
        <Label>Date Range</Label>
        <select value={transactions.range} onChange={(e) => transactions.onRange(e.target.value)} className="ss-in" style={s(AUTO_INPUT)}>
          {TXN_RANGE_PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {transactions.range === 'custom' && (
        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
          <div><Label>Start Date</Label><input type="date" value={transactions.from} max={nyToday()} onChange={(e) => transactions.onFrom(e.target.value)} className="ss-in" style={s(AUTO_INPUT)} /></div>
          <div><Label>End Date</Label><input type="date" value={transactions.to} min={transactions.from} max={nyToday()} onChange={(e) => transactions.onTo(e.target.value)} className="ss-in" style={s(AUTO_INPUT)} /></div>
        </div>
      )}
    </div>
  );
}
