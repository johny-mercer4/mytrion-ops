import { useState } from 'react';
import {
  Banknote,
  Building2,
  CreditCard,
  Fuel,
  Landmark,
  Receipt,
  ArrowLeftRight,
  Ticket,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useCachedLoad } from '../_shared/swrCache';
import {
  getClientInvoices,
  getClientPayments,
  getClientTransactions,
  type FinanceClientDetail,
  type TxnRange,
} from '../../api/finance';
import {
  ageClass,
  Badge,
  CacheBar,
  financeKeys,
  PanelSkeleton,
  PanelState,
  Rollup,
  Row,
  RowNode,
  Section,
  STALE,
  statusTone,
} from './panelBits';
import { dateOnly, dateTime, money, money0, num, toNum } from './financeFormat';

/**
 * Panels for the Finance client modal: Details, Invoices, Payments and Transactions.
 *
 * Each panel loads on FIRST OPEN of its tab (the strip mounts one at a time), so opening a modal costs
 * one small request rather than four — and every panel goes through the shared SWR cache, so returning
 * to a tab you have already opened repaints from cache instead of refetching. See panelBits.tsx for the
 * keys, the staleness windows, and why each cached panel shows its age.
 *
 * NOTE the modal is portalled to <body>, outside `.fi-root` — every class used here must be styled
 * by an unscoped rule in finance.css, not a `.fi-root`-descendant one.
 */

// ─── Details ─────────────────────────────────────────────────────────────────────────────────

export function DetailsPanel({
  detail,
  loading,
  error,
}: {
  detail: FinanceClientDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <PanelSkeleton />;
  if (error) return <div className="fi-error">{error}</div>;
  if (!detail) return null;

  const utilisation =
    detail.creditLimit > 0 ? Math.round((detail.computedDebt / detail.creditLimit) * 100) : null;

  return (
    <div className="fi-stack">
      <Rollup
        cells={[
          {
            label: 'Outstanding',
            value: detail.isDebtor ? money(detail.computedDebt) : '$0.00',
            ...(detail.isDebtor ? { variant: 'debt' as const } : {}),
          },
          { label: 'Open invoices', value: num(detail.openInvoices) },
          {
            label: 'Oldest debt',
            value: detail.computedDebtDays > 0 ? `${num(detail.computedDebtDays)} days` : '—',
          },
          { label: 'Credit limit', value: detail.creditLimit > 0 ? money0(detail.creditLimit) : '—' },
        ]}
      />

      <Section icon={<Building2 size={13} />} title="Company" tone="var(--accent)">
        <Row label="Company name" value={detail.companyName} variant="strong" />
        <Row label="Carrier ID" value={detail.carrierId} mono />
        <Row label="Contact" value={detail.contact} />
        <Row label="Phone" value={detail.phone} mono />
        <Row label="Email" value={detail.email} />
        <Row label="DOT" value={detail.dot} mono />
        <Row label="Owning agent" value={detail.agentName} />
      </Section>

      <Section icon={<Wallet size={13} />} title="Billing & terms" tone="var(--fi-pending)">
        <Row label="Payment terms" value={detail.paymentTerms} variant="strong" />
        <Row label="Billing type" value={detail.billingType.replace(/_/g, ' ')} />
        <Row label="Billing cycle" value={detail.billingCycle.replace(/_/g, ' ')} />
        <Row label="Payment day" value={detail.paymentDay} />
        <Row label="Money code" value={detail.moneyCode} mono />
        <RowNode label="LOC suspended">
          <Badge
            label={detail.isLocSuspended ? 'Suspended' : 'Active'}
            tone={detail.isLocSuspended ? 'var(--fi-debt)' : 'var(--fi-paid)'}
          />
        </RowNode>
      </Section>

      <Section icon={<Landmark size={13} />} title="Credit & exposure" tone="var(--fi-debt)">
        <Row
          label="Outstanding balance"
          value={detail.isDebtor ? money(detail.computedDebt) : '$0.00'}
          mono
          variant={detail.isDebtor ? 'debt' : 'paid'}
        />
        <Row label="Open invoices" value={num(detail.openInvoices)} mono />
        <Row
          label="Oldest open debt"
          value={detail.computedDebtDays > 0 ? `${num(detail.computedDebtDays)} days` : ''}
          mono
        />
        <Row label="Credit limit" value={detail.creditLimit > 0 ? money(detail.creditLimit) : ''} mono />
        <Row
          label="Limit used"
          value={utilisation === null ? '' : `${utilisation}%`}
          mono
          variant={utilisation !== null && utilisation >= 90 ? 'debt' : undefined}
        />
        <Row label="Credit score" value={detail.creditScore > 0 ? num(detail.creditScore) : ''} mono />
      </Section>

      <Section icon={<Fuel size={13} />} title="Activity" tone="var(--fi-paid)">
        <Row label="Active cards" value={num(detail.activeCards)} mono />
        <RowNode label="Fuelling status">
          <Badge
            label={detail.computedIsActive ? 'Active' : 'Inactive'}
            tone={detail.computedIsActive ? 'var(--fi-paid)' : 'var(--fi-idle)'}
          />
        </RowNode>
        <Row label="First swipe" value={dateOnly(detail.firstSwipeAt)} mono />
        <Row label="Last transaction" value={dateOnly(detail.lastTransactionAt)} mono />
      </Section>
    </div>
  );
}

// ─── Invoices (DWH public.cmp_invoice) ───────────────────────────────────────────────────────

export function InvoicesPanel({ carrierId }: { carrierId: string }) {
  const load = useCachedLoad(financeKeys.invoices(carrierId), () => getClientInvoices(carrierId), {
    staleMs: STALE.INVOICES,
  });
  const d = load.data;
  const billed = d?.invoices.reduce((s, i) => s + i.totalAmount, 0) ?? 0;
  const paid = d?.invoices.reduce((s, i) => s + i.totalPaid, 0) ?? 0;

  return (
    <PanelState
      loading={load.loading}
      error={load.error}
      empty={!!d && d.invoices.length === 0}
      emptyTitle="No invoices"
      emptyMsg="This carrier has no CMP invoices on record."
    >
      {d ? (
        <div className="fi-stack">
          {/* Outside any `.is-busy` region on purpose — see the note by .fi-cachebar in finance.css.
              These reads are fast, so "Refreshing…" in the bar is signal enough without dimming. */}
          <CacheBar cachedAt={load.cachedAt} revalidating={load.revalidating} onRefresh={load.reload} />
          <Rollup
            cells={[
              { label: 'Outstanding', value: money(d.totalOutstanding), variant: 'debt' },
              { label: 'Open invoices', value: num(d.openCount) },
              { label: 'Total billed', value: money(billed) },
              { label: 'Total paid', value: money(paid), variant: 'paid' },
            ]}
          />
          <div className="fi-tablewrap">
            <div className="fi-tablescroll">
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Issued</th>
                    <th>Due</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Paid</th>
                    <th style={{ textAlign: 'right' }}>Outstanding</th>
                    <th style={{ textAlign: 'right' }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {d.invoices.map((inv) => (
                    <tr key={inv.id} className={inv.isOpen ? 'is-open' : ''}>
                      <td className="fi-strong">#{inv.id}</td>
                      <td>{dateOnly(inv.invoiceDate) || '—'}</td>
                      <td>{dateOnly(inv.dueDate) || '—'}</td>
                      <td>
                        {inv.periodFrom ? `${dateOnly(inv.periodFrom)} → ${dateOnly(inv.periodTo)}` : '—'}
                      </td>
                      <td>
                        <Badge label={inv.status || 'unknown'} tone={statusTone(inv.status)} />
                      </td>
                      <td className="fi-num">{money(inv.totalAmount)}</td>
                      <td className="fi-num fi-paid">{inv.totalPaid > 0 ? money(inv.totalPaid) : '—'}</td>
                      <td className={`fi-num${inv.outstanding > 0 ? ' fi-debt' : ''}`}>
                        {inv.outstanding > 0 ? money(inv.outstanding) : '—'}
                      </td>
                      <td className={inv.isOpen ? ageClass(inv.ageDays) : 'fi-num'}>
                        {inv.isOpen ? `${num(inv.ageDays)}d` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>{num(d.invoices.length)} invoices</td>
                    <td className="fi-num">{money(billed)}</td>
                    <td className="fi-num fi-paid">{money(paid)}</td>
                    <td className="fi-num fi-debt">{money(d.totalOutstanding)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </PanelState>
  );
}

// ─── Payments (our own payment_transactions) ─────────────────────────────────────────────────

export function PaymentsPanel({ carrierId }: { carrierId: string }) {
  const load = useCachedLoad(financeKeys.payments(carrierId), () => getClientPayments(carrierId), {
    staleMs: STALE.PAYMENTS,
  });
  const d = load.data;
  const mapped = d?.payments.filter((p) => p.isInvoiceMapped).length ?? 0;
  const returned = d?.payments.filter((p) => p.isReturned).length ?? 0;

  return (
    <PanelState
      loading={load.loading}
      error={load.error}
      empty={!!d && d.payments.length === 0}
      emptyTitle="No payments"
      emptyMsg="No payments in our ledger are matched to this carrier id yet."
    >
      {d ? (
        <div className="fi-stack">
          <CacheBar cachedAt={load.cachedAt} revalidating={load.revalidating} onRefresh={load.reload} />
          <Rollup
            cells={[
              { label: 'Total received', value: money(d.totalAmount), variant: 'paid' },
              { label: 'Payments', value: num(d.payments.length) },
              { label: 'Mapped to invoices', value: `${num(mapped)} / ${num(d.payments.length)}` },
              { label: 'Returned', value: num(returned), ...(returned > 0 ? { variant: 'debt' as const } : {}) },
            ]}
          />
          <div className="fi-tablewrap">
            <div className="fi-tablescroll">
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Sender</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th>Status</th>
                    <th>Mapping</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{dateTime(p.occurredAt) || '—'}</td>
                      <td className="fi-strong">{(p.source || '—').toUpperCase()}</td>
                      <td>{p.senderName || p.name || '—'}</td>
                      <td className="fi-num fi-paid">{money(p.amount)}</td>
                      <td>
                        {p.isReturned ? (
                          <Badge label="Returned" tone="var(--fi-debt)" />
                        ) : p.status ? (
                          <Badge label={p.status} tone={statusTone(p.status)} />
                        ) : (
                          <Badge label="Received" tone="var(--fi-paid)" />
                        )}
                      </td>
                      <td>
                        {p.isInvoiceMapped ? (
                          <Badge label={p.mappingType || 'Mapped'} tone="var(--fi-paid)" />
                        ) : (
                          <Badge label="Unmapped" tone="var(--fi-idle)" />
                        )}
                      </td>
                      <td>{p.externalTxnId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>{num(d.payments.length)} payments</td>
                    <td className="fi-num fi-paid">{money(d.totalAmount)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </PanelState>
  );
}

// ─── Transactions (DWH mart_transaction_line_items) ──────────────────────────────────────────

const RANGES: { id: TxnRange; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
  { id: 'all_time', label: 'All time' },
];

export function TransactionsPanel({ carrierId }: { carrierId: string }) {
  /**
   * Defaults to ALL TIME, not this month. A carrier you open in the modal is often one you are
   * chasing precisely because they stopped fuelling — defaulting to the current month showed
   * "no transactions" for exactly those accounts, which reads as a broken tab rather than an
   * answer. All-time + the 100-row cap gives the 100 most recent, which is what you want first.
   */
  const [range, setRange] = useState<TxnRange>('all_time');
  // Longest staleness of any panel: a settled fuel line item never changes, so re-reading the mart on
  // a tab switch buys nothing.
  const load = useCachedLoad(
    financeKeys.transactions(carrierId, range),
    () => getClientTransactions(carrierId, range),
    { staleMs: STALE.TXNS },
  );

  // Rows live under `data` (backend DwhTxnResult) — NOT `transactions`/`rows`.
  const rows = load.data?.data ?? [];
  const totals = load.data?.totals ?? {};
  const gallons = toNum(totals.total_fuel_quantity ?? totals.fuel_quantity);
  const spend = toNum(totals.funded_total);

  const bar = (
    <div className="fi-subbar">
      <span className="fi-subbar-l">Range</span>
      <div className={`fi-chiprow${load.revalidating ? ' is-busy' : ''}`}>
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="fi-chip"
            aria-pressed={range === r.id}
            onClick={() => setRange(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fi-stack">
      {bar}
      <CacheBar cachedAt={load.cachedAt} revalidating={load.revalidating} onRefresh={load.reload} />
      <PanelState
        loading={load.loading}
        error={load.error}
        empty={!!load.data && rows.length === 0}
        emptyTitle="No fuel transactions"
        emptyMsg={
          range === 'all_time'
            ? 'This carrier has never fuelled on our cards.'
            : 'Nothing in this range — try a wider one.'
        }
      >
        <div className="fi-stack">
          <Rollup
            cells={[
              { label: 'Gallons', value: num(gallons) },
              { label: 'Fuel spend', value: money0(spend) },
              { label: 'Transactions', value: num(totals.transactions ?? rows.length) },
              { label: 'Showing', value: `${num(rows.length)} line items` },
            ]}
          />
          <div className="fi-tablewrap">
            <div className="fi-tablescroll">
              <table className="fi-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Location</th>
                    <th>Card</th>
                    <th>Item</th>
                    <th style={{ textAlign: 'right' }}>Gallons</th>
                    <th style={{ textAlign: 'right' }}>PPU</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const loc = String(r['location_name'] ?? '').trim();
                    const st = String(r['location_state'] ?? '').trim();
                    return (
                      <tr key={`${String(r['transaction_id'] ?? i)}-${i}`}>
                        <td>{String(r['transaction_date'] ?? '—').slice(0, 16)}</td>
                        <td className="fi-strong">{loc ? (st ? `${loc}, ${st}` : loc) : '—'}</td>
                        <td>{String(r['card_number'] ?? '—')}</td>
                        <td>
                          {r['line_item_category'] ? (
                            <Badge label={String(r['line_item_category'])} tone="var(--accent)" />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="fi-num">{num(r['line_item_fuel_quantity'])}</td>
                        <td className="fi-num">{money(r['line_item_price_per_unit'])}</td>
                        <td className="fi-num">{money(r['line_item_amount'])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </PanelState>
    </div>
  );
}

// ─── Coming soon ─────────────────────────────────────────────────────────────────────────────

/**
 * EFS top-up / sweep and Money Codes both MOVE MONEY. They stay unbuilt rather than half-wired:
 * a write surface needs an audited, role-gated endpoint behind it first.
 */
export function ComingSoonPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="fi-empty">
      <Banknote size={30} />
      <div className="fi-empty-title">{title}</div>
      <p style={{ maxWidth: '52ch', lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}

export const PANEL_ICONS = {
  details: Building2,
  invoices: Receipt,
  payments: Banknote,
  transactions: ArrowLeftRight,
  efs: Wallet,
  moneyCodes: Ticket,
  card: CreditCard,
  trend: TrendingUp,
} as const;
