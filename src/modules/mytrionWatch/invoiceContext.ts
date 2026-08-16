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
  createDate: string | null;
  dueDate: string | null;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  status: string | null;
  paymentCount: number;
  lastPaymentDate: string | null;
  /** Days since the invoice was raised — Billing's age clock. */
  debtDays: number | null;
  /** Open by Billing's definition, not by arithmetic. See OPEN_STATUSES. */
  isOpen: boolean;
}

export interface CarrierInvoiceContext {
  invoices: CarrierInvoice[];
  openCount: number;
  openAmount: number;
  /** Age of the oldest open invoice, for the "oldest debt" line Billing shows. */
  oldestOpenDays: number | null;
}

/**
 * What "open" means — Billing Mytrion's Debtors screen is the authority.
 *
 * We previously called an invoice open whenever `total_amount - total_paid > 0`, which is arithmetic
 * rather than a definition: a CANCELLED invoice still has a face value and no payment against it, so
 * it read as money owed. Measured over the 725 carriers scored on 2026-08-11, the panel claimed
 * 824 invoices / $6,842,763 outstanding, of which $6,068,152 was CANCELLED and $715,897 DELETED —
 * 99.14% of the total. The genuine figure under this rule is 33 invoices / $56,452.
 *
 * Mirrors servercrm `services/billingDwh.js getAllDebtors()`; the $1 floor is its
 * DEBT_OPEN_BALANCE_MIN. Billing's two grace windows (a 2-day settlement wait and a per-carrier
 * payment_day) are deliberately NOT applied here — they suppress collections noise, and this panel
 * answers "what is outstanding right now", not "who should Collections chase today". On the scored
 * book that difference is 3 invoices / $2,245.
 */
const OPEN_STATUSES = new Set(['PENDING', 'PARTIALLY_PAID']);
const OPEN_MIN = 1;

function isOpenInvoice(status: string | null, outstanding: number): boolean {
  return OPEN_STATUSES.has((status ?? '').toUpperCase()) && outstanding >= OPEN_MIN;
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
    i.create_date::date::text                            as "createDate",
    i.due_date::date::text                               as "dueDate",
    coalesce(i.total_amount, 0)::float8                  as "totalAmount",
    coalesce(i.total_paid, 0)::float8                    as "totalPaid",
    greatest(coalesce(i.total_amount,0) - coalesce(i.total_paid,0), 0)::float8 as "outstanding",
    i.status                                             as "status",
    -- Billing ages an invoice from create_date, not due_date and not invoice_date.
    (current_date - i.create_date::date)::int            as "debtDays",
    count(p.invoice_payment_id)::int                     as "paymentCount",
    max(p.payment_date)::date::text                      as "lastPaymentDate"
  from octane.stg_cmp_invoice i
  left join octane.stg_cmp_invoice_payment p on p.invoice_id = i.invoice_id
  where i.carrier_id = $1::bigint
  group by i.invoice_id, i.invoice_date, i.create_date, i.due_date,
           i.total_amount, i.total_paid, i.status
  order by i.invoice_date desc nulls last
  limit $2
`;

export async function carrierInvoices(
  carrierId: string,
  limit = 25,
): Promise<CarrierInvoiceContext> {
  if (!/^\d+$/.test(carrierId)) {
    return { invoices: [], openCount: 0, openAmount: 0, oldestOpenDays: null };
  }
  const rows = await dwh.query<Omit<CarrierInvoice, 'isOpen'>>(SQL, [carrierId, limit]);
  // Decided once, server-side, so the panel cannot drift from the definition.
  const invoices: CarrierInvoice[] = rows.map((r) => ({
    ...r,
    isOpen: isOpenInvoice(r.status, r.outstanding),
  }));
  const open = invoices.filter((r) => r.isOpen);
  return {
    invoices,
    openCount: open.length,
    openAmount: open.reduce((sum, r) => sum + r.outstanding, 0),
    oldestOpenDays: open.reduce<number | null>(
      (max, r) => (r.debtDays === null ? max : Math.max(max ?? 0, r.debtDays)),
      null,
    ),
  };
}
