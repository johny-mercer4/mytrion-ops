/**
 * Live analytics — curated, parameterized SQL over the read-only DWH pool.
 *
 * This file is the dispatcher only. Each dimension's SQL lives in `dimensions/*.ts` (the computes
 * outgrew the 600-line file cap once Customer Service and Finance stopped borrowing other
 * dimensions' blocks); shared formatting/soft-fail helpers live in `shared.ts`.
 *
 * Optional AnalyticsFilters (agent + date) are bound as `$n` params and never concatenated.
 */
import { computeBilling } from './dimensions/billing.js';
import { computePipeline } from './dimensions/pipeline.js';
import { computeReceivables } from './dimensions/receivables.js';
import { computeSales } from './dimensions/sales.js';
import { computeSupport } from './dimensions/support.js';
import { computeTransactions } from './dimensions/transactions.js';
import { normalizeFilters, type AnalyticsFilters } from './filters.js';
import type { AnalyticsBlock, AnalyticsDimension } from './types.js';

export async function computeAnalyticsBlock(
  dimension: AnalyticsDimension,
  filters?: AnalyticsFilters | null,
): Promise<AnalyticsBlock> {
  const f = normalizeFilters(filters);
  switch (dimension) {
    case 'sales':
      return computeSales(f);
    case 'pipeline':
      return computePipeline(f);
    case 'support':
      return computeSupport(f);
    case 'transactions':
      return computeTransactions(f);
    case 'billing':
      return computeBilling(f);
    case 'receivables':
      return computeReceivables(f);
  }
}
