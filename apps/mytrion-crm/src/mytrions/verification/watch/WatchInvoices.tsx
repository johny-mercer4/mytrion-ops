/**
 * Open invoices beside the score.
 *
 * Context, NOT a model input. The score already reflects payment behaviour through its own features;
 * this answers the question a credit agent asks next — "what is actually outstanding right now" —
 * which the score cannot express as a number.
 *
 * Fetched on its own because it is a live warehouse read while everything else on this page comes
 * from our snapshot. If the DWH is slow or down, this panel says so and the score is unaffected.
 */
import { useCallback } from 'react';
import { useCachedLoad } from '../../_shared/swrCache';
import { fmtDate, fmtMoney } from './watchFormat';
import { getCarrierInvoices } from '@/api/mytrionWatch';

export function WatchInvoices({ carrierId }: { carrierId: string }) {
  const load = useCallback(() => getCarrierInvoices(carrierId), [carrierId]);
  const { data, loading, error } = useCachedLoad(`verification:watch:invoices:${carrierId}`, load);

  const invoices = data?.invoices ?? [];
  const open = data?.openCount ?? 0;

  return (
    <section className="mw-pane" data-span="full">
      <h3 className="mw-pane-title">Invoices</h3>
      <p className="mw-pane-sub">
        {loading && !data
          ? 'Reading the warehouse…'
          : open > 0
            ? `${open} open · ${fmtMoney(data?.openAmount ?? 0)} outstanding right now.`
            : invoices.length > 0
              ? 'Nothing outstanding — every invoice on file is settled.'
              : 'No invoices on file for this carrier.'}
      </p>

      {error ? (
        // The score is unaffected, and saying which half failed is the difference between a broken
        // page and a partial one.
        <p className="mw-pane-sub">
          Invoice history is unavailable right now. The score above is unaffected — it is read from
          our own snapshot.
        </p>
      ) : invoices.length === 0 ? null : (
        <div className="mw-table">
          <div className="mw-thead" aria-hidden="true">
            <span>Invoiced</span>
            <span>Amount</span>
            <span>Paid</span>
            <span className="mw-th-effect">Outstanding</span>
          </div>
          <ul className="mw-trows">
            {invoices.map((inv) => (
              <li key={inv.invoiceId} className="mw-trow" data-missing={inv.outstanding > 0.005}>
                <span className="mw-tcell mw-tname">
                  <span className="mw-tlabel">{fmtDate(inv.invoiceDate)}</span>
                  <span className="mw-thelp">
                    {inv.status ?? 'Unknown status'}
                    {/* A part-paid invoice is invisible in the overdue list the score reads. */}
                    {inv.paymentCount > 1 ? ` · ${inv.paymentCount} payments` : ''}
                    {inv.lastPaymentDate ? ` · last paid ${fmtDate(inv.lastPaymentDate)}` : ''}
                  </span>
                </span>
                <span className="mw-tcell mw-tvalue">{fmtMoney(inv.totalAmount)}</span>
                <span className="mw-tcell mw-tbin">{fmtMoney(inv.totalPaid)}</span>
                <span className="mw-tcell mw-tvalue" data-open={inv.outstanding > 0.005 || undefined}>
                  {inv.outstanding > 0.005 ? fmtMoney(inv.outstanding) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
