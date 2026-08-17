/**
 * Open invoices beside the score.
 *
 * Context, NOT a model input. The score already reflects payment behaviour through its own features;
 * this answers the question a credit agent asks next — "what is actually outstanding right now" —
 * which the score cannot express as a number.
 *
 * Fetched on its own because it is a live warehouse read while everything else on this page comes
 * from our snapshot. If the DWH is slow or down, this panel says so and the score is unaffected.
 *
 * WHAT COUNTS AS OPEN is Billing Mytrion's definition, decided server-side in `invoiceContext.ts`
 * and arriving as `isOpen`. This panel must never re-derive it from `outstanding > 0`: a CANCELLED
 * invoice still has a face value and no payment against it, which is how the header once read
 * "1 open · $789 outstanding" above a single greyed-out CANCELLED row.
 */
import { useCallback } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Clock, FileText } from 'lucide-react';
import { useCachedLoad } from '../../_shared/swrCache';
import { fmtDate, fmtMoney } from './watchFormat';
import { getCarrierInvoices, type CarrierInvoice } from '@/api/mytrionWatch';

/** Billing's hard-debt line. An invoice older than this is the one to talk about first. */
const HARD_DEBT_DAYS = 15;

/** Billing's own words for a status — not the warehouse's SCREAMING_CASE. */
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Awaiting payment',
  PARTIALLY_PAID: 'Part paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  DELETED: 'Removed',
};

function statusOf(inv: CarrierInvoice): { label: string; tone: 'open' | 'late' | 'settled' | 'void' } {
  const raw = (inv.status ?? '').toUpperCase();
  const label = STATUS_LABEL[raw] ?? inv.status ?? 'Unknown';
  if (!inv.isOpen) return { label, tone: raw === 'PAID' ? 'settled' : 'void' };
  return { label, tone: (inv.debtDays ?? 0) >= HARD_DEBT_DAYS ? 'late' : 'open' };
}

const TONE_ICON = {
  open: Clock,
  late: AlertTriangle,
  settled: CheckCircle2,
  void: CircleSlash,
} as const;

export function WatchInvoices({ carrierId }: { carrierId: string }) {
  const load = useCallback(() => getCarrierInvoices(carrierId), [carrierId]);
  const { data, loading, error } = useCachedLoad(`verification:watch:invoices:${carrierId}`, load);

  const invoices = data?.invoices ?? [];
  const open = data?.openCount ?? 0;
  const oldest = data?.oldestOpenDays ?? null;

  return (
    <section className="mw-pane" data-span="full">
      <h3 className="mw-pane-title">Invoices</h3>

      {loading && !data ? (
        <p className="mw-inv-lede">Reading the warehouse…</p>
      ) : error ? (
        // The score is unaffected, and saying which half failed is the difference between a broken
        // page and a partial one.
        <p className="mw-inv-lede">
          Invoice history is unavailable right now. The score above is unaffected — it is read from
          our own snapshot.
        </p>
      ) : open > 0 ? (
        <div className="mw-inv-head">
          <span className="mw-inv-figure" data-tone={oldest !== null && oldest >= HARD_DEBT_DAYS ? 'late' : 'open'}>
            {fmtMoney(data?.openAmount ?? 0)}
          </span>
          <span className="mw-inv-caption">
            still owed across {open} unpaid invoice{open === 1 ? '' : 's'}
            {oldest !== null ? ` · oldest is ${oldest} day${oldest === 1 ? '' : 's'} old` : ''}
          </span>
        </div>
      ) : (
        <div className="mw-inv-head">
          <span className="mw-inv-figure" data-tone="settled">
            Nothing owed
          </span>
          <span className="mw-inv-caption">
            {invoices.length > 0
              ? 'Every invoice on file is settled, cancelled or removed.'
              : 'No invoices on file for this carrier.'}
          </span>
        </div>
      )}

      {error || invoices.length === 0 ? null : (
        <ul className="mw-inv-list">
          {invoices.map((inv) => {
            const { label, tone } = statusOf(inv);
            const Icon = TONE_ICON[tone];
            return (
              <li key={inv.invoiceId} className="mw-inv-row" data-tone={tone}>
                <Icon className="mw-inv-icon" size={20} aria-hidden />
                <span className="mw-inv-main">
                  <span className="mw-inv-title">
                    Invoice #{inv.invoiceId}
                    <span className="mw-inv-status">{label}</span>
                  </span>
                  <span className="mw-inv-meta">
                    Raised {fmtDate(inv.createDate ?? inv.invoiceDate)}
                    {inv.debtDays !== null ? ` · ${inv.debtDays} days ago` : ''}
                    {inv.paymentCount > 1 ? ` · ${inv.paymentCount} payments` : ''}
                    {inv.lastPaymentDate ? ` · last paid ${fmtDate(inv.lastPaymentDate)}` : ''}
                  </span>
                </span>
                <span className="mw-inv-amounts">
                  <span className="mw-inv-amt">
                    <span className="mw-inv-amt-k">Billed</span>
                    <span className="mw-inv-amt-v">{fmtMoney(inv.totalAmount)}</span>
                  </span>
                  <span className="mw-inv-amt">
                    <span className="mw-inv-amt-k">Paid</span>
                    <span className="mw-inv-amt-v">{fmtMoney(inv.totalPaid)}</span>
                  </span>
                  <span className="mw-inv-amt" data-owed={inv.isOpen || undefined}>
                    <span className="mw-inv-amt-k">Still owed</span>
                    {/* Not `outstanding > 0` — a cancelled invoice has a balance nobody owes. */}
                    <span className="mw-inv-amt-v">{inv.isOpen ? fmtMoney(inv.outstanding) : '—'}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {invoices.length > 0 && invoices.some((i) => !i.isOpen && i.outstanding > 0.005) ? (
        <p className="mw-inv-foot">
          <FileText size={15} aria-hidden />
          Cancelled and removed invoices still show the amount they were raised for, but nobody owes
          them — so they count as nothing owed.
        </p>
      ) : null}
    </section>
  );
}
