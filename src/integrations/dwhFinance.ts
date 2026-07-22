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

export async function fetchFinanceTransactions(params: { limit?: number } = {}) {
  const limit = params.limit ?? 100;
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
    ORDER BY transaction_date DESC
    LIMIT $1
  `, [limit]);
  return rows;
}
