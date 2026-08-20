import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { paymentTransactions } from '../db/schema/index.js';

/**
 * Same semantics as `paymentTransactionRepo.sumForPrepay`, one carrier, bucketed per calendar day
 * (UTC, matching that function's own bounds) — the prepay ledger modal's zelle/chase/merchant daily
 * columns.
 *
 * The modal's other columns (top_up/rmve/money_code/stripe) still come from servercrm's Zoho-era
 * ledger (services/prepayLedger.js) via a straight proxy; only `maintenance` had been overridden
 * from our own Postgres so far (see modules/billing/prepayLedger.ts). Zelle/Chase/Merchant need the
 * exact same treatment: servercrm's columns read Zoho's `Zelle_Transactions`/`Chase_Transactions`
 * modules directly, which newer payments (ingested straight into `payment_transactions` since the
 * Postgres migration) never get written back into — so the modal shows them as missing even though
 * `sumForPrepay` already counts them correctly in the company list total.
 *
 * Lives in its own file, re-exported as `paymentTransactionRepo.sumForPrepayByDay`, so that repo's
 * file stays under the 600-line cap without changing the method's public shape or call sites.
 */
export async function sumForPrepayByDay(
  sources: string[],
  carrierId: string,
  startYmd: string,
  endExclusiveYmd: string,
): Promise<Array<{ day: string; source: string; total: number }>> {
  if (sources.length === 0) return [];
  const startUtc = `${startYmd}T00:00:00+00:00`;
  const endUtc = `${endExclusiveYmd}T00:00:00+00:00`;
  const dayExpr = sql`(${paymentTransactions.occurredAt} at time zone 'UTC')::date`;
  const rows = await db
    .select({
      day: sql<string>`${dayExpr}::text`,
      source: paymentTransactions.source,
      total: sql<number>`sum(${paymentTransactions.amount})::float8`,
    })
    .from(paymentTransactions)
    .where(
      and(
        inArray(paymentTransactions.source, sources),
        eq(paymentTransactions.carrierId, carrierId),
        sql`${paymentTransactions.occurredAt} >= ${startUtc}`,
        sql`${paymentTransactions.occurredAt} < ${endUtc}`,
      ),
    )
    .groupBy(dayExpr, paymentTransactions.source);
  return rows.map((r) => ({ day: r.day, source: r.source, total: Number(r.total) || 0 }));
}
