import { dwhQuery } from './dwh.js';

export async function fetchFinanceDebtors(params: { limit?: number } = {}) {
  const limit = params.limit ?? 50;
  const rows = await dwhQuery(`
    SELECT
      c.company_name,
      c.carrier_id::text as carrier_id,
      'System Agent' as agent_name,
      'LOC' as payment_terms,
      b.max_debt_days,
      b.invoice_count,
      CAST(b.debt_amount AS FLOAT) as total_remaining
    FROM octane.mart_bad_debtors b
    JOIN octane.rpt_debtor_companies c ON c.carrier_id = b.carrier_id
    ORDER BY b.debt_amount DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

/**
 * Recent fuel transactions, org-wide.
 *
 * `page` and `search` exist because this touchpoint replaced a servercrm passthrough that had them:
 * when it became a local DWH query it kept only `limit`, and since the params schema was a plain
 * (non-strict) zod object the two dropped keys were silently stripped — a caller paginating or
 * searching got a successful 200 and the unfiltered first page. Restored here rather than deleted
 * from the schema, because the finance roster is ~8k carriers and page-1-of-everything is not a
 * usable answer.
 */
export async function fetchFinanceTransactions(
  params: { limit?: number; page?: number; search?: string } = {},
) {
  const limit = params.limit ?? 100;
  const offset = ((params.page ?? 1) - 1) * limit;
  const search = params.search?.trim();
  // Escape LIKE metacharacters so a literal % or _ in a company name matches itself rather than
  // silently widening the search (backslash is Postgres's default LIKE escape character).
  const needle = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  // $3 is only referenced when a needle exists, so the arg list stays in step with the SQL.
  const where = needle
    ? `WHERE company_name ILIKE $3
          OR carrier_id::text ILIKE $3
          OR card_number ILIKE $3
          OR location_name ILIKE $3`
    : '';
  const rows = await dwhQuery(`
    SELECT
      transaction_id::text as transaction_id,
      company_name,
      carrier_id::text as carrier_id,
      card_number as card,
      payment_terms,
      NOT is_loc_suspended as active,
      line_item_category as fuel_type,
      CAST(transaction_fuel_quantity AS FLOAT) as gallons,
      CAST(transaction_price_per_unit AS FLOAT) as ppu,
      CAST(line_item_retail_price_per_unit AS FLOAT) as retail,
      CAST(disc_amount AS FLOAT) as discount,
      CAST(funded_total AS FLOAT) as amount,
      location_name as location,
      location_state as state,
      transaction_date as date
    FROM octane.mart_transaction_line_items
    ${where}
    ORDER BY transaction_date DESC
    LIMIT $1 OFFSET $2
  `, needle ? [limit, offset, needle] : [limit, offset]);
  return rows;
}
