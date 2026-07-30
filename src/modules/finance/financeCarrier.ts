/**
 * Finance Mytrion → client modal: the per-carrier reads behind the Invoices / Payments /
 * Transactions tabs. Each is independent so the modal can load a tab only when it's opened.
 *
 * Sources, one per tab:
 *   Invoices      DWH `public.cmp_invoice` — the SAME table the debtor figure is computed from, so
 *                 the invoice list always reconciles with the debt shown on the roster. Read from
 *                 the warehouse snapshot rather than servercrm's live CMP hop (modules/billing/
 *                 cmpReads.searchCarrierInvoices) because this is a read-only panel and the DWH is
 *                 an order of magnitude faster.
 *   Payments      our OWN `payment_transactions` (Postgres), matched on `carrier_id`.
 *   Transactions  DWH `octane.mart_transaction_line_items` via the shared listDwhTransactions.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { paymentTransactions, type PaymentTransaction } from '../../db/schema/index.js';
import { dwhQuery } from '../../integrations/dwh.js';

/** Statuses that count as still owing — the shared debtor definition. */
const OPEN_STATUSES = ['PENDING', 'PARTIALLY_PAID'];

export interface FinanceInvoice {
  id: string;
  invoiceDate: string | null;
  dueDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  status: string;
  billingType: string;
  billingCycle: string;
  totalAmount: number;
  totalPaid: number;
  /** total_amount − total_paid, floored at 0. */
  outstanding: number;
  discount: number;
  merchantFee: number;
  moneyCodeTotal: number;
  /** Age in days by create_date — what drives `debt_days` on the roster. */
  ageDays: number;
  isOpen: boolean;
}

export interface FinanceInvoicesResult {
  invoices: FinanceInvoice[];
  totalOutstanding: number;
  openCount: number;
}

/** `timestamp without time zone` → the naive date the DB actually holds (no zone shift). */
function naiveDate(v: unknown): string | null {
  if (v == null) return null;
  if (!(v instanceof Date)) return String(v);
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** One carrier's CMP invoices, newest first, with the outstanding roll-up the header shows. */
export async function fetchCarrierInvoices(
  carrierId: string,
  limit = 200,
): Promise<FinanceInvoicesResult> {
  const cap = Math.min(Math.max(limit, 1), 1000);
  const rows = await dwhQuery<Record<string, unknown>>(
    `select id, invoice_date, due_date, date_from, date_to, status, billing_type, billing_cycle,
            total_amount, total_paid, total_discount_amount, total_merchant_fee,
            money_code_total_amount, create_date,
            (current_date - create_date::date)::int as age_days
       from public.cmp_invoice
      where carrier_id = $1::bigint
      order by invoice_date desc nulls last, id desc
      limit $2`,
    [carrierId, cap],
  );

  let totalOutstanding = 0;
  let openCount = 0;
  const invoices: FinanceInvoice[] = rows.map((r) => {
    const total = num(r['total_amount']);
    const paid = num(r['total_paid']);
    const outstanding = Math.max(total - paid, 0);
    const status = str(r['status']);
    const isOpen = OPEN_STATUSES.includes(status) && outstanding > 0;
    if (isOpen) {
      totalOutstanding += outstanding;
      openCount += 1;
    }
    return {
      id: str(r['id']),
      invoiceDate: naiveDate(r['invoice_date']),
      dueDate: naiveDate(r['due_date']),
      periodFrom: naiveDate(r['date_from']),
      periodTo: naiveDate(r['date_to']),
      status,
      billingType: str(r['billing_type']),
      billingCycle: str(r['billing_cycle']),
      totalAmount: total,
      totalPaid: paid,
      outstanding,
      discount: num(r['total_discount_amount']),
      merchantFee: num(r['total_merchant_fee']),
      moneyCodeTotal: num(r['money_code_total_amount']),
      ageDays: num(r['age_days']),
      isOpen,
    };
  });

  return { invoices, totalOutstanding, openCount };
}

export interface FinancePaymentsResult {
  payments: PaymentTransaction[];
  totalAmount: number;
}

/**
 * One carrier's payments from OUR ledger (`payment_transactions`), newest first.
 *
 * That table is keyed on the CMP `carrier_id` domain and is deliberately NOT tenant-scoped (see the
 * schema header) — it's a global operational table, so there is no tenant filter to apply here.
 * `carrier_id` is TEXT on the row, matching how Zoho stored it.
 */
export async function fetchCarrierPayments(
  carrierId: string,
  limit = 200,
): Promise<FinancePaymentsResult> {
  const cap = Math.min(Math.max(limit, 1), 1000);
  const rows = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.carrierId, carrierId))
    // `occurredAt` is the rail's "best" timestamp; fall back to id so rows with no timestamp still
    // land in a stable order rather than shuffling between requests.
    .orderBy(desc(paymentTransactions.occurredAt), desc(paymentTransactions.id))
    .limit(cap);

  const totalAmount = rows.reduce((sum, r) => sum + num(r.amount), 0);
  return { payments: rows, totalAmount };
}
