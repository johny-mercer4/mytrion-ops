/**
 * Customer Service Mytrion Deluge touchpoints — the read surface of the old
 * zoho-octane/app/mytrion-customer-service widget. Unwrap modes mirror each function's
 * verified envelope (see the widget panels + scripts/standalone/*.dg in zoho-octane):
 *  - mytrionGetApplications / mytrionbillingdatacenterdeals return {status:'success', …}
 *    envelopes whose siblings (more_records/page, total_deals/is_delta) the UI needs →
 *    'status' (validates and returns the WHOLE payload).
 *  - mytrionGetHomeMetrics has no reliable success wrapper; the widget only rejects an
 *    explicit status:'error' → 'cardAction'.
 * Writes (Applications save, Citifuel CRUD, Data Center deal edits) are NOT touchpoints —
 * they run through the /cs/* routes with field-casing resolution and auditing. Maintenance is not
 * here at all any more: it lives in our own `maintenance_cases` table, served by /cs/maintenance and
 * /cs/analytics/maintenance.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { idString, limit } from './common.js';

const CS_DEPARTMENTS = ['customer-service'] as const;

export const csDelugeTouchpoints: Touchpoint[] = [
  {
    kind: 'deluge',
    key: 'cs.home.metrics',
    title: 'Customer Service home metrics (team + personal)',
    riskClass: 'read',
    departments: CS_DEPARTMENTS,
    identityParam: 'userId',
    functionNames: ['mytrionGetHomeMetrics'],
    unwrap: 'cardAction',
    paramsSchema: z.object({ userId: idString.optional() }),
  },
  {
    kind: 'deluge',
    key: 'cs.applications.list',
    title: 'Applications / Clients table (enriched with Deal + owner data)',
    riskClass: 'read',
    departments: CS_DEPARTMENTS,
    functionNames: ['mytrionGetApplications'],
    unwrap: 'status',
    // The Deluge signature takes page/perPage as STRINGS (widget parity).
    // perPage up to 2000 — Zoho COQL max per call (avoids 200-row loop round-trips).
    paramsSchema: z.object({
      tab: z.enum(['apps', 'clients']).default('apps'),
      search: z.string().max(300).optional().default(''),
      page: limit(10_000, 1).transform(String),
      perPage: limit(2000, 2000).transform(String),
    }),
  },
  /*
   * `cs.analytics.maintenance` was REMOVED here. Maintenance lives in our own
   * `maintenance_cases` table now, and this entry called the `mytrionGetMaintenanceAnalytics`
   * Deluge — so leaving it in the catalog meant `POST /v1/touchpoints/cs.analytics.maintenance`
   * could still hand back Zoho's numbers, which no longer match the tab. Superseded by
   * `GET /cs/analytics/maintenance` (SQL, integrations/csMaintenance.ts).
   *
   * The Deluge function itself is untouched in Zoho: the legacy
   * zoho-octane/app/mytrion-customer-service widget calls it directly through
   * ZOHO.CRM.FUNCTIONS.execute and never goes via this catalog, so it keeps working.
   */
  {
    kind: 'deluge',
    key: 'cs.datacenter.deals',
    title: 'Data Center deals (full or delta sync)',
    riskClass: 'read',
    departments: CS_DEPARTMENTS,
    functionNames: ['mytrionbillingdatacenterdeals'],
    unwrap: 'status',
    // lastSyncTime '' = full load; a COQL timestamp = delta since then (widget parity).
    paramsSchema: z.object({ lastSyncTime: z.string().max(40).default('') }),
  },
];
