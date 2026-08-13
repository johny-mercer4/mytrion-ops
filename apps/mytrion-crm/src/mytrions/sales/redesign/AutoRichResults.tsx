/**
 * Rich Automations results — balance (C-8/Q-8), account status (Q-7/C-28), tracking (C-22),
 * WEX tasks (C-2/C-19) and payments (C-18/Q-2). Mirrors zoho-octane actionResult kinds.
 */
import { s, Badge } from './dc';
import { badge } from './salesData';
import { AutoEmptyState } from './AutoActionResult';
import {
  trackingStatusUrl,
  type AccountStatusResult,
  type BalanceCheckResult,
  type CmpInvoiceRow,
  type PaymentsSummary,
  type TrackingEntry,
  type WexTaskEntry,
} from './autoLive';

const mono = "font-family:var(--font-mono)";
const warnNote = 'padding:11px 13px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);font-size:13px;color:var(--text2);line-height:1.45';

/** One headline figure. `tone` colours the value only — the label stays the muted caption. */
function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="ss-pay-stat">
      <div className="ss-track-label">{label}</div>
      <div className="ss-pay-stat-value" style={s(tone ? `${mono};color:${tone}` : mono)}>{value}</div>
    </div>
  );
}

/** Secondary key/value grid — only the fields the source actually answered for. */
function MetaGrid({ rows }: { rows: Array<[string, string]> }) {
  const filled = rows.filter(([, value]) => value && value !== '—');
  if (filled.length === 0) return null;
  return (
    <article className="ss-track-card">
      <div className="ss-track-card-grid">
        {filled.map(([label, value]) => (
          <div key={label}>
            <div className="ss-track-label">{label}</div>
            <div className="ss-track-value">{value}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * Balance Check (C-8 / Q-8) — the three blocks CRM Mytrion showed, in its order.
 * A plain sentence made agents re-read which figure was the line and which was what was left.
 */
export function AutoBalancePanel({ result }: { result: BalanceCheckResult }) {
  return (
    <section className="ss-auto-rich" aria-label={`Balance for ${result.companyName}`}>
      <div className="ss-auto-rich-title">Balance — {result.companyName}</div>
      <div className="ss-pay-grid">
        <StatTile label="EFS Balance" value={result.efsBalance} tone="var(--ok)" />
        <StatTile label="Available Limit" value={result.availableLimit} tone="var(--accent)" />
        <StatTile label="Weekly Limit" value={result.weeklyLimit} />
      </div>
      <MetaGrid
        rows={[
          ['Account type', result.accountType],
          ['Payment terms', result.paymentTerms],
          ['Billing cycle', result.billingCycle],
          ['Credit used', result.creditUsed],
        ]}
      />
      {result.efsError ? <div style={s(warnNote)}>EFS: {result.efsError}</div> : null}
    </section>
  );
}

/**
 * Account Status Check (Q-7 / C-28) — carrier overview in blocks: money, debt, cards.
 * Same data the CRM widget showed; the one-line summary dropped everything but three figures.
 */
export function AutoAccountStatusPanel({ result }: { result: AccountStatusResult }) {
  const debtTone = result.totalDebt === '$0' ? 'var(--ok)' : 'var(--warn)';
  return (
    <section className="ss-auto-rich" aria-label={`Account status for ${result.companyName}`}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap')}>
        <div className="ss-auto-rich-title">Account Status — {result.companyName}</div>
        <div style={s('display:flex;align-items:center;gap:6px')}>
          <Badge vm={badge(result.isActive ? 'ACTIVE' : 'INACTIVE', result.isActive ? 'var(--ok)' : 'var(--danger)')} />
          {result.isHardDebtor ? <Badge vm={badge('HARD DEBTOR', 'var(--danger)')} /> : null}
        </div>
      </div>
      <div className="ss-pay-grid">
        <StatTile label="EFS Balance" value={result.efsBalance} tone="var(--ok)" />
        <StatTile label="Weekly Limit" value={result.weeklyLimit} />
        <StatTile label="Open debt" value={result.totalDebt} tone={debtTone} />
      </div>
      <div className="ss-pay-grid">
        <StatTile
          label={result.cardsLive ? 'Active cards (live EFS)' : 'Active cards'}
          value={`${result.activeCards} / ${result.totalCards}`}
          tone="var(--accent)"
        />
        <StatTile label="Invoices in debt" value={result.debtInvoiceCount} />
        <StatTile label="Oldest debt" value={result.maxDebtDays} />
      </div>
      <MetaGrid
        rows={[
          ['Account type', result.accountType],
          ['Payment terms', result.paymentTerms],
          ['Worst invoice status', result.worstStatus],
        ]}
      />
      {result.notices.map((notice) => (
        <div key={notice} style={s(warnNote)}>{notice}</div>
      ))}
    </section>
  );
}

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

/**
 * The label is whatever CMP calls it — only the TONE is derived. This used to relabel anything
 * containing "paid" as "Paid", which silently turned a Partially Paid invoice into a settled one on
 * screen no matter what CMP said (carrier 5815660). Partial is checked first for the same reason.
 */
function cmpStatusBadge(status: string) {
  const x = status.toLowerCase();
  if (x.includes('partial')) return badge(status, 'var(--warn)');
  if (x.includes('paid')) return badge(status, 'var(--ok)');
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
      <div className="ss-auto-rich-title" style={s('font-size:var(--ss-text-sm);margin-top:4px')}>CMP Invoices</div>
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
