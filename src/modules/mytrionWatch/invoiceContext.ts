/**
 * Open invoices for one carrier — context beside the score, never an input to it.
 *
 * Deliberately its OWN endpoint rather than part of the carrier detail. Every other Watch read comes
 * from our snapshot table and never touches the warehouse, which is why the desk is fast and still
 * renders when the DWH is down; folding a live CMP query into the detail would give that up for the
 * whole page. Loaded on its own, this panel degrades alone.
 *
 * `stg_cmp_invoice_payment` is a ledger — one row per payment — so an invoice part-paid three times
 * shows all three. The overdue list the score is built from collapses those into one figure, which
 * is exactly why this is worth showing and NOT worth feeding to the model without a retrain.
 */
import { dwh } from '../../integrations/dwh.js';

export interface CarrierInvoice {
  invoiceId: string;
  invoiceDate: string | null;
  dueDate: string | null;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  status: string | null;
  paymentCount: number;
  lastPaymentDate: string | null;
}

export interface CarrierInvoiceContext {
  invoices: CarrierInvoice[];
  openCount: number;
  openAmount: number;
}

/** Most recent first; the desk cares about what is open now, not the full history. */
/**
 * Most recent first; the desk cares about what is open now, not the full history.
 *
 * Aliases are QUOTED camelCase. Postgres folds unquoted identifiers to lower case, so `as
 * invoice_date` comes back on a snake_case key and a camelCase interface over it is a type that
 * lies — every field reads `undefined` at runtime while the compiler is happy.
 */
const SQL = `
  select
    i.invoice_id::text                                   as "invoiceId",
    i.invoice_date::date::text                           as "invoiceDate",
    i.due_date::date::text                               as "dueDate",
    coalesce(i.total_amount, 0)::float8                  as "totalAmount",
    coalesce(i.total_paid, 0)::float8                    as "totalPaid",
    greatest(coalesce(i.total_amount,0) - coalesce(i.total_paid,0), 0)::float8 as "outstanding",
    i.status                                             as "status",
    count(p.invoice_payment_id)::int                     as "paymentCount",
    max(p.payment_date)::date::text                      as "lastPaymentDate"
  from octane.stg_cmp_invoice i
  left join octane.stg_cmp_invoice_payment p on p.invoice_id = i.invoice_id
  where i.carrier_id = $1::bigint
  group by i.invoice_id, i.invoice_date, i.due_date, i.total_amount, i.total_paid, i.status
  order by i.invoice_date desc nulls last
  limit $2
`;

export async function carrierInvoices(
  carrierId: string,
  limit = 25,
): Promise<CarrierInvoiceContext> {
  if (!/^\d+$/.test(carrierId)) return { invoices: [], openCount: 0, openAmount: 0 };
  const rows = await dwh.query<CarrierInvoice>(SQL, [carrierId, limit]);
  const open = rows.filter((r) => r.outstanding > 0.005);
  return {
    invoices: rows,
    openCount: open.length,
    openAmount: open.reduce((sum, r) => sum + r.outstanding, 0),
  };
}
