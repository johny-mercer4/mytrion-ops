import { z } from 'zod';
import { getAnalyticsSnapshot } from '../../analytics/cache.js';
import { ANALYTICS_DIMENSIONS } from '../../analytics/types.js';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  /** Which dashboard block to read. */
  dimension: z.enum(ANALYTICS_DIMENSIONS),
});

const outputSchema = z.object({
  dimension: z.enum(ANALYTICS_DIMENSIONS),
  computedAt: z.string(),
  ttlMinutes: z.number(),
  block: z.record(z.unknown()),
});

/**
 * Company analytics snapshot — the SAME cached, server-computed numbers the live dashboard shows
 * (curated read-only DWH queries; the model never writes SQL). Served from the 2h snapshot cache,
 * so calling it is cheap. Internal audience only; org-wide aggregates identical to what every
 * internal worker already sees on the dashboard — no per-carrier or per-customer detail.
 */
export const analyticsSnapshotTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'analytics.snapshot',
  description:
    'Live company analytics snapshot (same data as the Analytics dashboard): pipeline = app fills, ' +
    'funnel stages, conversion, top agents; transactions = gallons, fuel spend, transaction counts, ' +
    'active carriers, chains, top agents; billing = client top-ups, balances, open debtor invoices. ' +
    "Use for 'how are sales this month', 'gallons today/this month', 'top agents', 'pipeline status', " +
    "'top-up volume'. Data refreshes every ~2h; computedAt says how fresh it is.",
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  rateLimit: { perMinute: 30 },
  async handler(input) {
    const snapshot = await getAnalyticsSnapshot(input.dimension);
    return {
      dimension: snapshot.dimension,
      computedAt: snapshot.computedAt,
      ttlMinutes: snapshot.ttlMinutes,
      block: snapshot.block as unknown as Record<string, unknown>,
    };
  },
};
