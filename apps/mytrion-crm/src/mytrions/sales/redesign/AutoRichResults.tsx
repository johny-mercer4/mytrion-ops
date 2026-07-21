/**
 * Rich Automations results — tracking (C-22) + WEX tasks (C-2/C-19).
 * Mirrors zoho-octane actionResult kinds `tracking` / `wex`.
 */
import { s, Badge } from './dc';
import { badge } from './salesData';
import { AutoEmptyState } from './AutoActionResult';
import {
  trackingStatusUrl,
  type CmpInvoiceRow,
  type PaymentsSummary,
  type TrackingEntry,
  type WexTaskEntry,
} from './autoLive';

const mono = "font-family:'JetBrains Mono',monospace";

function fmtWhen(raw: string): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function TrackingLink({ number }: { number: string }) {
  const href = trackingStatusUrl(number);
  if (!href) return <span style={s(`${mono};font-weight:700`)}>{number}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ss-track-link"
      title="Open shipment status"
    >
      {number}
    </a>
  );
}

export function AutoTrackingPanel({
  carrierId,
  fedexTracking,
  entries,
}: {
  carrierId: string;
  fedexTracking: string;
  entries: TrackingEntry[];
}) {
  return (
    <div className="ss-auto-rich">
      <div className="ss-auto-rich-title">Tracking Info — Carrier {carrierId}</div>
      {fedexTracking ? (
        <div className="ss-track-summary">
          <div className="ss-track-summary-label">Initial Tracking Number</div>
          <TrackingLink number={fedexTracking} />
        </div>
      ) : null}
      {entries.length === 0 ? (
        <AutoEmptyState
          title="No tracking entries found"
          message="No tracking entries found for this carrier."
          icon="package"
          compact
        />
      ) : (
        <div className="ss-track-list">
          {entries.map((e) => (
            <article key={e.id} className="ss-track-card">
              <div className="ss-track-card-row">
                <span className="ss-track-label">Tracking Number</span>
                <TrackingLink number={e.trackingNumber} />
              </div>
              <div className="ss-track-card-grid">
                <div>
                  <div className="ss-track-label">Start Date</div>
                  <div className="ss-track-value">{fmtWhen(e.startDate)}</div>
                </div>
                <div>
                  <div className="ss-track-label">Cards Ordered</div>
                  <div className="ss-track-value">{e.cardsOrdered}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function AutoWexTasksPanel({
  appId,
  summary,
  tasks,
}: {
  appId: string;
  summary: string;
  tasks: WexTaskEntry[];
}) {
  const hasSummary = summary.trim().length > 0;
  const hasTasks = tasks.length > 0;
  // Deluge often fills `wexTaskField` (summary) with the full update text while
  // `wexTasks[]` is empty — that summary IS the result; don't show empty under it.
  const isEmpty = !hasSummary && !hasTasks;

  return (
    <div className="ss-auto-rich">
      <div className="ss-auto-rich-title">Application Updates — App {appId}</div>
      {hasSummary ? (
        <div className="ss-wex-summary">
          <div className="ss-wex-summary-label">Current Update — Full Wex Task Field</div>
          <div className="ss-wex-summary-text">{summary}</div>
        </div>
      ) : null}
      {hasTasks ? (
        <div className="ss-wex-list">
          {tasks.map((t) => (
            <article key={t.id} className="ss-wex-card">
              <div className="ss-wex-card-head">
                <div className="ss-wex-card-subject">{t.subject}</div>
                <div className="ss-wex-card-date">Received: {fmtWhen(t.createdDate)}</div>
              </div>
              <div className="ss-wex-card-body">{t.description}</div>
            </article>
          ))}
        </div>
      ) : null}
      {isEmpty ? (
        <AutoEmptyState
          title="No WEX tasks found"
          message="No WEX tasks found for this application."
          icon="clipboardCheck"
          compact
        />
      ) : null}
    </div>
  );
}

function cmpStatusBadge(status: string) {
  const x = status.toLowerCase();
  if (x.includes('paid')) return badge('Paid', 'var(--ok)');
  if (x.includes('overdue') || x.includes('pending')) return badge(status, 'var(--warn)');
  return badge(status || '—', 'var(--muted)');
}

/** Payments (C-18/Q-2) — DWH payment-info summary + live CMP invoices, fetched in parallel. */
export function AutoPaymentsPanel({
  summary,
  cmpInvoices,
  cmpError,
}: {
  summary: PaymentsSummary | null;
  cmpInvoices: CmpInvoiceRow[];
  cmpError?: string | undefined;
}) {
  return (
    <div className="ss-auto-rich">
      <div className="ss-auto-rich-title">Payments (90 days)</div>
      {summary ? (
        <div className="ss-pay-grid">
          {([
            ['Invoice count', summary.invoiceCount],
            ['Total billed', summary.totalBilled],
            ['Total paid', summary.totalPaid],
            ['Open balance', summary.openBalance],
            ['Payment count', summary.paymentCount],
            ['Payments total', summary.paymentsTotal],
          ] as const).map(([label, value]) => (
            <div key={label} className="ss-pay-stat">
              <div className="ss-track-label">{label}</div>
              <div className="ss-pay-stat-value" style={s(mono)}>{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <AutoEmptyState title="No payment summary" message="DWH payment info wasn't available for this carrier." icon="card" compact />
      )}
      <div className="ss-auto-rich-title" style={s('font-size:13px;margin-top:4px')}>CMP Invoices</div>
      {cmpError ? (
        <AutoEmptyState title="CMP invoice check failed" message={cmpError} icon="alert" compact />
      ) : cmpInvoices.length === 0 ? (
        <AutoEmptyState title="No CMP invoices found" message="No live CMP invoices found for this carrier." icon="invoice" compact />
      ) : (
        <div className="ss-track-list">
          {cmpInvoices.map((inv) => (
            <article key={inv.id} className="ss-track-card">
              <div className="ss-track-card-row">
                <span style={s(`${mono};font-weight:700`)}>{inv.invoiceNumber}</span>
                <Badge vm={cmpStatusBadge(inv.status)} />
              </div>
              <div className="ss-track-card-grid" style={s('grid-template-columns:1fr 1fr 1fr')}>
                <div>
                  <div className="ss-track-label">Total</div>
                  <div className="ss-track-value">{inv.total}</div>
                </div>
                <div>
                  <div className="ss-track-label">Paid</div>
                  <div className="ss-track-value">{inv.paid}</div>
                </div>
                <div>
                  <div className="ss-track-label">Remaining</div>
                  <div className="ss-track-value">{inv.remaining}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
