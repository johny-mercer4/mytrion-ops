/**
 * Ledger source feeds — one function per Debit/Credit term in the TZ's five sub-ledgers.
 *
 * TWO RULES THAT MAKE THE WHOLE MODEL HOLD:
 *
 * 1. EVERY FEED IS ONE SET-BASED `GROUP BY` OVER THE WHOLE CARRIER SET. Never per-carrier. A whole
 *    portfolio pass is 4 DWH queries + 3 Postgres queries — seven, not 2,847. A per-carrier loop here
 *    would be the difference between a page load and an outage.
 *
 * 2. THE CHAIN IS SHARED CODE, NOT CONVENTION. The TZ says "Credit of one section becomes Debit of the
 *    next". `carrierTransactions()` is called by BOTH Customer Balance's Credit and Unbilled's Debit;
 *    `invoiced()` is called by BOTH Unbilled's Credit and AR's Debit; `topUps()` by BOTH Customer
 *    Balance's Debit and Un Top-Upped's Credit. So the links are true by construction and a test can
 *    assert equality rather than hoping two queries stayed in sync.
 *
 * NO FEED TOUCHES EFS. EFS is a live, slow, per-carrier vendor API whose loads/money-code history caps
 * at 90 days (a wider window 400s rather than clamping). It is used only for point-in-time balance
 * reconciliation, which has no window and so no cap. Top-ups come from the DWH's own FundStation
 * mirror, which has unbounded history.
 *
 * THE THREE CLOCKS (this is the most dangerous area of the feature):
 *   • `cmp_billing_history.create_date`  → timestamptz, EFS stamps Central. Bucket in LEDGER_TZ.
 *   • `payment_transactions.occurred_at` → timestamptz. Bucket in LEDGER_TZ.
 *   • `cmp_transaction.transaction_date` → `timestamp WITHOUT time zone`. Apply NO `AT TIME ZONE`;
 *     converting a zoneless column shifts every row. Compared as a plain half-open range.
 *   • `cmp_invoice.invoice_date` / `cmp_invoice_payment.payment_date` → naive; compared as dates.
 *   • `maintenance_cases.case_date` / `money_code_requests.requested_ny_date` → plain `date`.
 * servercrm's own prepay ledger buckets America/New_York, so its numbers can differ from ours by up to
 * one day at a period boundary. That is expected and recorded in WORKING_NOTES.md, not a bug to fix.
 *
 * `endDateExclusive` is EXCLUSIVE in every function here. The route layer converts the agent's
 * inclusive date once; nothing below re-interprets it.
 */
import { dwh } from '../../../integrations/dwh.js';
import {
  LOC_PAYMENT_METHOD,
  PREPAY_PAYMENT_METHOD,
} from '../../customerService/maintenanceFields.js';
import { maintenanceCaseRepo } from '../../../repos/maintenanceCaseRepo.js';
import { moneyCodeRequestRepo } from '../../../repos/moneyCodeRequestRepo.js';
import { paymentTransactionRepo } from '../../../repos/paymentTransactionRepo.js';
import type { LedgerClientType } from './sections.js';

/**
 * The ledger's reporting day. Both feeds that define Customer Balance are Central (EFS stamps CT) and
 * ops' prepay figures already bucket CT — matching them is what keeps Billing's two screens agreeing.
 * Exported so nobody re-litigates it per query.
 */
export const LEDGER_TZ = 'America/Chicago';

export interface Period {
  /** yyyy-mm-dd, inclusive. */
  startDate: string;
  /** yyyy-mm-dd, EXCLUSIVE. */
  endDateExclusive: string;
}

/** carrierId → amount. Absent means zero; the caller decides which. */
export type CarrierSums = Map<string, number>;

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function toSums(rows: readonly { carrier_id: string | number; amt: string | number }[]): CarrierSums {
  const out: CarrierSums = new Map();
  for (const r of rows) out.set(String(r.carrier_id), n(r.amt));
  return out;
}

/**
 * Central-TZ day bucketing for `cmp_billing_history`, copied VERBATIM from
 * ../prepayLedger.ts so the Ledger and the Prepay tab can never disagree on which day a load
 * belongs to. The raw `create_date` range is one day wider on each side purely so the index stays
 * usable; the CT-date predicate is what makes it correct.
 */
const BILLING_HISTORY_DAY_PREDICATE = `
      create_date >= $1::date - interval '1 day'
  AND create_date <  $2::date + interval '1 day'
  AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date >= $1::date
  AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date <  $2::date`;

export interface TopUpRow {
  /** Money loaded onto the carrier's EFS account. */
  loads: number;
  /** Money pulled back off it (RMVE). */
  draws: number;
}

/**
 * Top-ups and draws per carrier (DWH FundStation mirror).
 *
 * Customer Balance's Debit is `loads − draws`. Netting the draws in — rather than putting them on the
 * Credit side — is what keeps this equal to ops' `loaded = TopUp − RMVE`, so the Ledger and the Prepay
 * tab report the same number. The TZ only says "all top-ups"; this reading is flagged for billing's
 * confirmation in the plan's open questions.
 */
export async function topUps(period: Period, carrierIds?: readonly string[]): Promise<Map<string, TopUpRow>> {
  const params: unknown[] = [period.startDate, period.endDateExclusive];
  let filter = '';
  if (carrierIds?.length) {
    params.push([...new Set(carrierIds)]);
    filter = ` AND carrier_id::text = ANY($${params.length}::text[])`;
  }
  const rows = await dwh.query<{ carrier_id: string | number; loads: string; draws: string }>(
    `SELECT carrier_id,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0)  AS loads,
            COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS draws
       FROM public.cmp_billing_history
      WHERE ${BILLING_HISTORY_DAY_PREDICATE}${filter}
      GROUP BY carrier_id`,
    params,
  );
  const out = new Map<string, TopUpRow>();
  for (const r of rows) out.set(String(r.carrier_id), { loads: n(r.loads), draws: n(r.draws) });
  return out;
}

/**
 * Card spend per carrier (DWH `public.cmp_transaction`, one row per transaction).
 *
 * ⚠️ `funded_total` is the amount. `net_total` on this table is UNPOPULATED — it sums to exactly 0.00
 * across a full week (verified 2026-08-06), so reading it would silently zero all card spend.
 *
 * ⚠️ Do NOT switch this to `octane.mart_transaction_line_items` and sum `funded_total` there: that
 * table is LINE-ITEM grained and repeats the per-transaction total across a transaction's items, so
 * the sum inflates. Measured for 2026-07-01→07-08:
 *     cmp_transaction.funded_total          $5,332,066.43  (13,783 rows)
 *     mart…line_items.line_item_amount      $5,332,066.43  (18,888 rows)  ← agrees to the cent
 *     mart…line_items.funded_total          $7,811,802.53                ← 46% overstated
 * `line_item_amount` is the correct column on the mart if it is ever needed there; this table is
 * cheaper and carries the invoice date window the Unbilled drill-down needs.
 */
export async function cardSpend(period: Period, carrierIds?: readonly string[]): Promise<CarrierSums> {
  const params: unknown[] = [period.startDate, period.endDateExclusive];
  let filter = '';
  if (carrierIds?.length) {
    params.push([...new Set(carrierIds)]);
    filter = ` AND carrier_id::text = ANY($${params.length}::text[])`;
  }
  const rows = await dwh.query<{ carrier_id: string | number; amt: string }>(
    // transaction_date is `timestamp without time zone` — NO `AT TIME ZONE`, or every row shifts.
    `SELECT carrier_id, COALESCE(SUM(funded_total), 0) AS amt
       FROM public.cmp_transaction
      WHERE transaction_date >= $1::date
        AND transaction_date <  $2::date
        AND carrier_id IS NOT NULL${filter}
      GROUP BY carrier_id`,
    params,
  );
  return toSums(rows);
}

/** The maintenance Payment_Method that reaches the EFS card for a client type. */
function maintenanceMethodsFor(clientType: LedgerClientType): string[] {
  return clientType === 'LOC' ? [LOC_PAYMENT_METHOD] : [PREPAY_PAYMENT_METHOD];
}

export interface CarrierTransactionSums {
  /** Per-component breakdown — the row subnote and the drill-down both need it. */
  fuel: CarrierSums;
  moneyCode: CarrierSums;
  maintenance: CarrierSums;
  /** fuel + moneyCode + maintenance. */
  total: CarrierSums;
}

/**
 * Everything a carrier spent in the period: card spend + money codes + maintenance (TZ §5.1/§5.2).
 *
 * THIS IS THE SHARED FEED. Customer Balance's Credit and Unbilled Transactions' Debit are both this
 * function, so `S1.credit === S2.debit` holds by construction rather than by two queries agreeing.
 *
 * Money codes come from OUR `money_code_requests`, not EFS: unbounded history, no 90-day cap, and it is
 * the row-of-record for every code Octane issued. A code drawn directly in EFS outside the request flow
 * would be missed — flagged in the plan's open questions.
 */
export async function carrierTransactions(
  period: Period,
  clientType: LedgerClientType,
  carrierIds?: readonly string[],
): Promise<CarrierTransactionSums> {
  const [fuel, moneyCode, maintenance] = await Promise.all([
    cardSpend(period, carrierIds),
    moneyCodeRequestRepo.sumByCarrier(period.startDate, period.endDateExclusive, carrierIds),
    maintenanceCaseRepo.sumByCarrierAndMethod(
      maintenanceMethodsFor(clientType),
      period.startDate,
      period.endDateExclusive,
      carrierIds,
    ),
  ]);

  const total: CarrierSums = new Map();
  for (const src of [fuel, moneyCode, maintenance]) {
    for (const [id, amt] of src) total.set(id, (total.get(id) ?? 0) + amt);
  }
  return { fuel, moneyCode, maintenance, total };
}

/**
 * Invoiced amount per carrier (DWH `public.cmp_invoice`).
 *
 * THE SECOND SHARED FEED: Unbilled Transactions' Credit and AR's Debit are both this, so
 * `S2.credit === S3.debit` also holds by construction.
 *
 * Keyed on `invoice_date`, matching the Invoiced KPI in ../../analytics/dimensions/receivables.ts —
 * the two must agree on what "invoiced this period" means. (`create_date` is what the debt-AGE rule
 * uses; a different question, and correct for its own purpose.) `CANCELLED` invoices are excluded, the
 * same predicate receivables.ts applies.
 */
export async function invoiced(period: Period, carrierIds?: readonly string[]): Promise<CarrierSums> {
  const params: unknown[] = [period.startDate, period.endDateExclusive];
  let filter = '';
  if (carrierIds?.length) {
    params.push([...new Set(carrierIds)]);
    filter = ` AND carrier_id::text = ANY($${params.length}::text[])`;
  }
  const rows = await dwh.query<{ carrier_id: string | number; amt: string }>(
    `SELECT carrier_id, COALESCE(SUM(total_amount), 0) AS amt
       FROM public.cmp_invoice
      WHERE invoice_date >= $1::date
        AND invoice_date <  $2::date
        AND status <> 'CANCELLED'${filter}
      GROUP BY carrier_id`,
    params,
  );
  return toSums(rows);
}

/**
 * Payments applied to invoices per carrier (DWH `public.cmp_invoice_payment` joined to its invoice for
 * the carrier id). AR's Credit.
 *
 * 🚨 DO NOT ALSO UNION `payment_transactions WHERE is_invoice_mapped = true`. Every mapping write in
 * src/routes/v1/billing.routes.ts pushes the payment into CMP via `applyInvoicePayment`, so it ALREADY
 * appears here. Adding both double-counts AR Credit — the single easiest way to get this feature wrong.
 * `payment_transactions` is used for the unmatched-payments queue and for drill-down provenance only.
 *
 * Returns need no feed either: matching a return reverses the CMP payment, so the row disappears from
 * this table and the ledger self-corrects on the next recompute.
 *
 * `is_failed` is excluded — the `PAYMENT_OK` rule from receivables.ts.
 */
export async function invoicePayments(period: Period, carrierIds?: readonly string[]): Promise<CarrierSums> {
  const params: unknown[] = [period.startDate, period.endDateExclusive];
  let filter = '';
  if (carrierIds?.length) {
    params.push([...new Set(carrierIds)]);
    filter = ` AND i.carrier_id::text = ANY($${params.length}::text[])`;
  }
  const rows = await dwh.query<{ carrier_id: string | number; amt: string }>(
    `SELECT i.carrier_id AS carrier_id, COALESCE(SUM(p.amount), 0) AS amt
       FROM public.cmp_invoice_payment p
       JOIN public.cmp_invoice i ON i.id = p.invoice_id
      WHERE p.payment_date >= $1::date
        AND p.payment_date <  $2::date
        AND COALESCE(p.is_failed, false) = false${filter}
      GROUP BY i.carrier_id`,
    params,
  );
  return toSums(rows);
}

/**
 * Payments RECEIVED from carriers in the period (our Postgres `payment_transactions`) — Un Top-Upped
 * Payments' Debit. All four rails live in that table.
 *
 * Returned payments are excluded: a returned payment is money that came back out, so counting it as
 * received would leave a permanent phantom in the transient section.
 *
 * NOTE a deliberate divergence from the Prepay tab: ../prepayLedger.ts force-zeroes MX Merchant (an ops
 * decision taken 2026-07-10), but a Prepay carrier's MX payment IS money received, so the ledger counts
 * it. The two screens will differ by that amount — flagged in the plan's open questions.
 */
export async function paymentsReceived(
  period: Period,
  carrierIds?: readonly string[],
): Promise<CarrierSums> {
  return paymentTransactionRepo.sumReceivedByCarrier(
    period.startDate,
    period.endDateExclusive,
    carrierIds,
  );
}

/**
 * Money received but not yet applied, as of a moment — Un Top-Upped Payments' independent check.
 * Point-in-time, not windowed: "what is still sitting unapplied" is a balance, not a flow.
 */
export async function unappliedPayments(
  asOfExclusive: string,
  carrierIds?: readonly string[],
): Promise<CarrierSums> {
  return paymentTransactionRepo.sumUnappliedByCarrier(asOfExclusive, carrierIds);
}

/**
 * Open AR per carrier as of now — AR's independent check.
 *
 * `DUE`/`OPEN_INVOICE` are the extracted rules from ./arRules.ts so this and
 * ../../analytics/dimensions/receivables.ts cannot drift apart.
 */
export async function openInvoiceBalance(carrierIds?: readonly string[]): Promise<CarrierSums> {
  const { DUE, OPEN_INVOICE } = await import('./arRules.js');
  const params: unknown[] = [];
  let filter = '';
  if (carrierIds?.length) {
    params.push([...new Set(carrierIds)]);
    filter = ` AND carrier_id::text = ANY($${params.length}::text[])`;
  }
  const rows = await dwh.query<{ carrier_id: string | number; amt: string }>(
    `SELECT carrier_id, COALESCE(SUM(${DUE}), 0) AS amt
       FROM public.cmp_invoice i
      WHERE ${OPEN_INVOICE}${filter}
      GROUP BY carrier_id`,
    params,
  );
  return toSums(rows);
}

/**
 * CMP's own running balance per carrier, as of the last movement on or before a date.
 *
 * This is the external check for Customer Balance on any HISTORICAL day. EFS only ever answers "what is
 * the balance NOW" — it has no as-of parameter — so a past day cannot be reconciled against EFS at all.
 * `stg_cmp_billing_history.balance_after` is CMP's own post-movement balance, read with
 * `distinct on (carrier_id) … order by create_date desc` (the pattern in
 * ../../analytics/dimensions/billing.ts).
 */
export async function cmpBalanceAsOf(
  asOfExclusive: string,
  carrierIds?: readonly string[],
): Promise<CarrierSums> {
  const params: unknown[] = [asOfExclusive];
  let filter = '';
  if (carrierIds?.length) {
    params.push([...new Set(carrierIds)]);
    filter = ` AND carrier_id::text = ANY($${params.length}::text[])`;
  }
  const rows = await dwh.query<{ carrier_id: string | number; amt: string }>(
    `SELECT DISTINCT ON (carrier_id) carrier_id, COALESCE(balance_after, 0) AS amt
       FROM octane.stg_cmp_billing_history
      WHERE (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date < $1::date
        AND balance_after IS NOT NULL${filter}
      ORDER BY carrier_id, create_date DESC`,
    params,
  );
  return toSums(rows);
}
