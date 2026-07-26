import type { ReactNode } from 'react';
import {
  ArrowLeftRight,
  Ban,
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  CreditCard,
  Fuel,
  Gauge,
  Hash,
  Mail,
  MapPin,
  Phone,
  Receipt,
  ShieldCheck,
  Sparkles,
  Ticket,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react';
import { useLoad } from '../_shared/useLoad';
import {
  getClientInvoices,
  getClientPayments,
  getClientTransactions,
  type FinanceClientDetail,
} from '../../api/finance';
import { dateOnly, dateTime, dash, money, money0, num, orDash, toNum } from './financeFormat';

/**
 * The Finance client modal's panels: Details, Invoices, Payments, Transactions, and the two
 * coming-soon placeholders. Split out of ClientModal.tsx to keep both files readable.
 *
 * Each data panel loads on FIRST OPEN of its tab (the tab strip mounts one panel at a time), so
 * opening a modal costs one small request rather than four.
 */

/** One labelled field with its own icon + hue. */
export function Field({
  icon,
  label,
  value,
  tone,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: string;
  mono?: boolean;
}) {
  return (
    <div className="fi-field">
      <span className="fi-field-ico" style={tone ? { ['--p' as string]: tone } : undefined}>
        {icon}
      </span>
      <div className="fi-field-main">
        <div className="fi-field-l">{label}</div>
        <div className={`fi-field-v${mono ? ' fi-mono' : ''}`}>{value}</div>
      </div>
    </div>
  );
}

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className="fi-pill" style={{ ['--p' as string]: tone }}>
      {label}
    </span>
  );
}

/** Invoice/payment status → hue. Anything unrecognised stays neutral rather than guessing. */
function statusTone(status: string): string {
  const s = status.toUpperCase();
  if (s === 'PAID' || s === 'COMPLETED' || s === 'SUCCEEDED') return 'var(--fi-paid)';
  if (s === 'PENDING' || s === 'PARTIALLY_PAID' || s === 'PROCESSING') return 'var(--fi-pending)';
  if (s === 'FAILED' || s === 'RETURNED' || s === 'CANCELLED') return 'var(--fi-debt)';
  return 'var(--fi-idle)';
}

function Rollup({ cells }: { cells: { label: string; value: string }[] }) {
  return (
    <div className="fi-rollup">
      {cells.map((c) => (
        <div key={c.label} className="fi-rollup-cell">
          <div className="fi-rollup-l">{c.label}</div>
          <div className="fi-rollup-v">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function PanelState({ loading, error, empty, emptyMsg, children }: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyMsg: string;
  children: ReactNode;
}) {
  if (loading) return <div className="fi-sk fi-sk-block" />;
  if (error) return <div className="fi-error">{error}</div>;
  if (empty) {
    return (
      <div className="fi-empty">
        <Sparkles size={26} />
        <div className="fi-empty-title">Nothing here</div>
        <p>{emptyMsg}</p>
      </div>
    );
  }
  return <>{children}</>;
}

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
  if (loading) return <div className="fi-sk fi-sk-block" />;
  if (error) return <div className="fi-error">{error}</div>;
  if (!detail) return null;

  return (
    <>
      <Rollup
        cells={[
          { label: 'Outstanding', value: detail.isDebtor ? money(detail.computedDebt) : '$0.00' },
          { label: 'Open invoices', value: num(detail.openInvoices) },
          { label: 'Oldest debt', value: detail.computedDebtDays > 0 ? `${num(detail.computedDebtDays)}d` : '—' },
          { label: 'Credit limit', value: detail.creditLimit > 0 ? money0(detail.creditLimit) : '—' },
        ]}
      />

      <div className="fi-fields">
        <Field icon={<Hash size={14} />} label="Carrier ID" value={detail.carrierId} mono tone="var(--accent)" />
        <Field icon={<Building2 size={14} />} label="Company" value={orDash(detail.companyName)} />
        <Field icon={<User size={14} />} label="Contact" value={orDash(detail.contact)} />
        <Field icon={<Phone size={14} />} label="Phone" value={orDash(detail.phone)} mono />
        <Field icon={<Mail size={14} />} label="Email" value={orDash(detail.email)} />
        <Field icon={<MapPin size={14} />} label="DOT" value={dash(detail.dot)} mono />

        <Field
          icon={<Wallet size={14} />}
          label="Payment terms"
          value={orDash(detail.paymentTerms)}
          tone={detail.paymentTerms === 'Prepay' ? 'var(--fi-paid)' : 'var(--accent-2, var(--accent))'}
        />
        <Field icon={<CreditCard size={14} />} label="Billing type" value={dash(detail.billingType.replace(/_/g, ' '))} />
        <Field icon={<CalendarDays size={14} />} label="Billing cycle" value={dash(detail.billingCycle.replace(/_/g, ' '))} />
        <Field icon={<CalendarClock size={14} />} label="Payment day" value={orDash(detail.paymentDay)} />
        <Field icon={<Gauge size={14} />} label="Credit score" value={dash(detail.creditScore)} mono />
        <Field icon={<Ticket size={14} />} label="Money code" value={dash(detail.moneyCode)} mono />

        <Field icon={<CreditCard size={14} />} label="Active cards" value={num(detail.activeCards)} mono />
        <Field
          icon={<ShieldCheck size={14} />}
          label="LOC suspended"
          value={detail.isLocSuspended ? 'Yes' : 'No'}
          tone={detail.isLocSuspended ? 'var(--fi-debt)' : 'var(--fi-paid)'}
        />
        <Field icon={<User size={14} />} label="Owning agent" value={orDash(detail.agentName)} />
        <Field icon={<Fuel size={14} />} label="First swipe" value={dateOnly(detail.firstSwipeAt) || '—'} mono />
        <Field
          icon={<TrendingUp size={14} />}
          label="Last transaction"
          value={dateOnly(detail.lastTransactionAt) || '—'}
          mono
          tone={detail.computedIsActive ? 'var(--fi-paid)' : 'var(--fi-idle)'}
        />
      </div>
    </>
  );
}

// ─── Invoices (DWH public.cmp_invoice) ───────────────────────────────────────────────────────

export function InvoicesPanel({ carrierId }: { carrierId: string }) {
  const load = useLoad(() => getClientInvoices(carrierId), [carrierId]);
  const d = load.data;
  return (
    <PanelState
      loading={load.loading}
      error={load.error}
      empty={!!d && d.invoices.length === 0}
      emptyMsg="This carrier has no CMP invoices."
    >
      {d ? (
        <>
          <Rollup
            cells={[
              { label: 'Outstanding', value: money(d.totalOutstanding) },
              { label: 'Open invoices', value: num(d.openCount) },
              { label: 'Invoices shown', value: num(d.invoices.length) },
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
                    <tr key={inv.id}>
                      <td className="fi-strong">#{inv.id}</td>
                      <td>{dateOnly(inv.invoiceDate) || '—'}</td>
                      <td>{dateOnly(inv.dueDate) || '—'}</td>
                      <td>
                        {inv.periodFrom ? `${dateOnly(inv.periodFrom)} → ${dateOnly(inv.periodTo)}` : '—'}
                      </td>
                      <td>
                        <Pill label={inv.status || 'UNKNOWN'} tone={statusTone(inv.status)} />
                      </td>
                      <td className="fi-num">{money(inv.totalAmount)}</td>
                      <td className="fi-num fi-paid">{money(inv.totalPaid)}</td>
                      <td className={`fi-num${inv.outstanding > 0 ? ' fi-debt' : ''}`}>
                        {inv.outstanding > 0 ? money(inv.outstanding) : '—'}
                      </td>
                      <td className="fi-num">{inv.isOpen ? `${num(inv.ageDays)}d` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </PanelState>
  );
}

// ─── Payments (our own payment_transactions) ─────────────────────────────────────────────────

export function PaymentsPanel({ carrierId }: { carrierId: string }) {
  const load = useLoad(() => getClientPayments(carrierId), [carrierId]);
  const d = load.data;
  return (
    <PanelState
      loading={load.loading}
      error={load.error}
      empty={!!d && d.payments.length === 0}
      emptyMsg="No payments in our ledger are mapped to this carrier."
    >
      {d ? (
        <>
          <Rollup
            cells={[
              { label: 'Total received', value: money(d.totalAmount) },
              { label: 'Payments', value: num(d.payments.length) },
              {
                label: 'Mapped to invoices',
                value: num(d.payments.filter((p) => p.isInvoiceMapped).length),
              },
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
                      <td>{orDash(p.senderName ?? p.name)}</td>
                      <td className="fi-num fi-paid">{money(p.amount)}</td>
                      <td>
                        {p.isReturned ? (
                          <Pill label="Returned" tone="var(--fi-debt)" />
                        ) : p.status ? (
                          <Pill label={p.status} tone={statusTone(p.status)} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {p.isInvoiceMapped ? (
                          <Pill label={p.mappingType || 'Mapped'} tone="var(--fi-paid)" />
                        ) : (
                          <Pill label="Unmapped" tone="var(--fi-idle)" />
                        )}
                      </td>
                      <td>{orDash(p.externalTxnId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </PanelState>
  );
}

// ─── Transactions (DWH mart_transaction_line_items) ──────────────────────────────────────────

/** The mart reader returns `{ transactions, totals }`; tolerate `rows` too rather than assume. */
function txnRows(d: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!d) return [];
  const t = d['transactions'] ?? d['rows'];
  return Array.isArray(t) ? (t as Record<string, unknown>[]) : [];
}

export function TransactionsPanel({ carrierId }: { carrierId: string }) {
  const load = useLoad(() => getClientTransactions(carrierId, 'month'), [carrierId]);
  const rows = txnRows(load.data as Record<string, unknown> | null);
  const gallons = rows.reduce((s, r) => s + toNum(r['line_item_fuel_quantity']), 0);
  const amount = rows.reduce((s, r) => s + toNum(r['line_item_amount']), 0);

  return (
    <PanelState
      loading={load.loading}
      error={load.error}
      empty={!!load.data && rows.length === 0}
      emptyMsg="No fuel transactions for this carrier this month."
    >
      <>
        <Rollup
          cells={[
            { label: 'Gallons · month', value: num(gallons) },
            { label: 'Fuel spend · month', value: money0(amount) },
            { label: 'Line items', value: num(rows.length) },
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
                {rows.map((r, i) => (
                  <tr key={`${String(r['transaction_id'] ?? i)}-${i}`}>
                    <td>{String(r['transaction_date'] ?? '—').slice(0, 16)}</td>
                    <td className="fi-strong">
                      {orDash(String(r['location_name'] ?? ''))}
                      {r['location_state'] ? `, ${String(r['location_state'])}` : ''}
                    </td>
                    <td>{orDash(String(r['card_number'] ?? ''))}</td>
                    <td>{orDash(String(r['line_item_category'] ?? ''))}</td>
                    <td className="fi-num">{num(r['line_item_fuel_quantity'])}</td>
                    <td className="fi-num">{money(r['line_item_price_per_unit'])}</td>
                    <td className="fi-num">{money(r['line_item_amount'])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    </PanelState>
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
  locked: Ban,
} as const;
