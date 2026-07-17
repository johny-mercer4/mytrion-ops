/**
 * Transaction line items straight from the DWH mart — the FAST half of the mini-app's progressive
 * transactions read.
 *
 * Why this exists next to `serverCrmWrapper.getTransactions`, which returns the same thing:
 * servercrm's endpoint merges a live EFS gap-fill on top of the mart, and that SOAP leg costs
 * 3–24s — measured, and it costs that even when it merges ZERO rows. This module skips it, so the
 * mini-app can paint the mart's rows in ~200ms and fold the fresh EFS tail in afterwards (the
 * caller then asks servercrm for the merged truth). servercrm is NOT modified — the zoho-octane
 * widgets keep using it exactly as before.
 *
 * The SQL, the ET-aligned range vocabulary, and the `totals` key names all mirror servercrm
 * (services/dwhTransactions.js + agentDwh.js `_resolveRange`) ON PURPOSE: both phases must resolve
 * the SAME window, or rows would jump between the fast paint and the merged refresh.
 *
 * Read-only, and raw SQL lives here (an integration), never in routes/ — repo rule 2.
 */
import { dwhQuery } from './dwh.js';
import { AppError } from '../lib/errors.js';

export interface DwhTxnRange {
  preset: string;
  /** null for all_time — no lower bound. */
  from: string | null;
  to: string | null;
}

export interface DwhTxnResult {
  data: Array<Record<string, unknown>>;
  totals: Record<string, unknown>;
  range: DwhTxnRange;
  pagination: Record<string, unknown>;
}

/** 'YYYY-MM-DD' in America/New_York — servercrm aligns every preset to ET, so we must too. */
function getEtToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** Monday of the ET week containing `etToday` (mirrors servercrm's getETWeekStart). */
function getEtWeekStart(etToday: string): string {
  const [y, m, d] = etToday.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const mon = new Date(Date.UTC(y, m - 1, d - daysFromMon));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${mon.getUTCFullYear()}-${pad(mon.getUTCMonth() + 1)}-${pad(mon.getUTCDate())}`;
}

/**
 * Resolve a preset (or an explicit from/to) into ET-aligned bounds — a faithful port of servercrm's
 * `_resolveRange`, aliases included, so the two phases can never disagree about the window.
 */
export function resolveDwhTxnRange(range?: string, fromArg?: string, toArg?: string): DwhTxnRange {
  const today = getEtToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const preset = String(range || 'all_time').trim().toLowerCase().replace(/[\s-]+/g, '_');

  let from: string | null = null;
  const to: string | null = preset === 'custom' ? (toArg ?? '').trim() : today;

  switch (preset) {
    case 'custom':
      if (!fromArg || !toArg) {
        throw new AppError('range=custom requires both from and to (YYYY-MM-DD).', {
          statusCode: 400,
          code: 'BAD_RANGE',
          expose: true,
        });
      }
      from = String(fromArg).trim();
      break;
    case 'day': case 'today': case 'this_day':
      from = today; break;
    case 'week': case 'this_week':
      from = getEtWeekStart(today); break;
    case 'month': case 'this_month': case 'mtd':
      from = `${today.slice(0, 7)}-01`; break;
    case 'quarter': case 'this_quarter': case 'qtd':
      from = `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`; break;
    case 'half': case 'half_year': case 'this_half_year': case 'semester': case 'h1h2':
      from = `${y}-${m <= 6 ? '01' : '07'}-01`; break;
    case 'year': case 'this_year': case 'ytd':
      from = `${y}-01-01`; break;
    case 'all': case 'all_time': case 'lifetime': case 'alltime':
      from = null; break;
    default:
      throw new AppError(
        `Unknown range "${range}". Use: day, week, month, quarter, half_year, year, all_time, or custom (with from & to).`,
        { statusCode: 400, code: 'BAD_RANGE', expose: true },
      );
  }
  return { preset, from, to };
}

/**
 * Re-flatten a `timestamp without time zone` back to the naive string the DB actually holds.
 *
 * `pg` parses that type into a JS Date using the SERVER's timezone, so the DB's "2026-07-16
 * 21:59:00" becomes a Date whose UTC instant is 16:59Z. JSON.stringify then emits
 * "2026-07-16T16:59:00.000Z" and the client renders 16:59 — a five-hour lie, and one that made the
 * fast phase disagree with servercrm's merged phase (which reports 21:59), so the list visibly
 * jumped when the refresh landed.
 *
 * Reading the LOCAL parts undoes the parse exactly: the timestamp has no zone to convert to, so the
 * value the DB wrote is the value we send. (toISOString would re-apply the shift.)
 */
function naiveTimestamp(v: unknown): unknown {
  if (!(v instanceof Date)) return v;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
}

export interface ListDwhTxnOpts {
  carrierId: string;
  /** Driver scoping — filters at the SQL level, so other cards' rows never leave Postgres. */
  cardNumber?: string | undefined;
  range?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
}

/**
 * One page of line items + totals accumulated over the WHOLE filter set (not just the page) —
 * matching servercrm's contract. `cardNumber`, when given, scopes both.
 */
export async function listDwhTransactions(opts: ListDwhTxnOpts): Promise<DwhTxnResult> {
  const resolved = resolveDwhTxnRange(opts.range, opts.from, opts.to);
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);

  const where: string[] = ['t.carrier_id = $1'];
  const params: unknown[] = [Number(opts.carrierId)];
  if (opts.cardNumber) {
    params.push(opts.cardNumber);
    where.push(`t.card_number = $${params.length}`);
  }
  if (resolved.from) {
    params.push(resolved.from);
    where.push(`t.transaction_date >= $${params.length}::date`);
  }
  if (resolved.to) {
    // Inclusive end-of-day: +1 day with a strict <, so a timestamp on the `to` day still counts.
    params.push(resolved.to);
    where.push(`t.transaction_date < ($${params.length}::date + INTERVAL '1 day')`);
  }
  const whereClause = `WHERE ${where.join(' AND ')}`;

  // Fetch limit+1 to detect more_records without a second count query (servercrm's trick).
  params.push(limit + 1);
  const limitIdx = params.length;

  const [rows, totalsRows] = await Promise.all([
    dwhQuery<Record<string, unknown>>(
      `SELECT t.*, dc.company_name, dc.payment_terms, dc.is_active AS company_is_active
         FROM octane.mart_transaction_line_items t
         LEFT JOIN octane.dim_company dc ON dc.carrier_id = t.carrier_id
         ${whereClause}
        ORDER BY t.transaction_date DESC, t.transaction_id ASC
        LIMIT $${limitIdx}`,
      params,
    ),
    dwhQuery<Record<string, unknown>>(
      `SELECT COUNT(*)                                        AS line_items_total,
              COUNT(DISTINCT t.transaction_id)                AS transactions_total,
              COALESCE(SUM(t.line_item_amount), 0)            AS sum_amount,
              COALESCE(SUM(t.line_item_fuel_quantity), 0)     AS sum_fuel_quantity,
              COALESCE(SUM(t.line_item_discount_amount), 0)   AS sum_discount_amount
         FROM octane.mart_transaction_line_items t
         ${whereClause}`,
      params.slice(0, -1),
    ),
  ]);

  const moreRecords = rows.length > limit;
  const page = moreRecords ? rows.slice(0, limit) : rows;
  // Normalise the one timestamp that is read by a human (the sheet, the CSV/XLSX/PDF).
  const data = page.map((r) => ({ ...r, transaction_date: naiveTimestamp(r['transaction_date']) }));
  const t = totalsRows[0] ?? {};
  const int = (v: unknown) => parseInt(String(v ?? '0'), 10) || 0;
  const flt = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
  const fuel = flt(t['sum_fuel_quantity']);

  return {
    data,
    // Key names mirror servercrm's countDwhTransactions RETURN VALUE (not its SQL aliases).
    totals: {
      transactions: int(t['transactions_total']),
      line_items: int(t['line_items_total']),
      funded_total: flt(t['sum_amount']),
      fuel_quantity: fuel,
      total_fuel_quantity: fuel,
      discount_amount: flt(t['sum_discount_amount']),
    },
    range: resolved,
    pagination: { page: 1, limit, count: data.length, more_records: moreRecords },
  };
}
