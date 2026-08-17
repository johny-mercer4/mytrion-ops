/**
 * Customer Service Mytrion Deluge touchpoints — the read surface of the old
 * zoho-octane/app/mytrion-customer-service widget. Unwrap modes mirror each function's
 * verified envelope (see the widget panels + scripts/standalone/*.dg in zoho-octane):
 *  - mytrionbillingdatacenterdeals returns a {status:'success', …} envelope whose siblings
 *    (total_deals/is_delta) the UI needs → 'status' (validates and returns the WHOLE payload).
 *  - mytrionGetHomeMetrics has no reliable success wrapper; the widget only rejects an
 *    explicit status:'error' → 'cardAction'.
 * Writes (Applications save, Citifuel CRUD, Data Center deal edits) are NOT touchpoints —
 * they run through the /cs/* routes with field-casing resolution and auditing. Maintenance is not
 * here at all any more: it lives in our own `maintenance_cases` table, served by /cs/maintenance and
 * /cs/analytics/maintenance.
 */
import { z } from 'zod';
import { fetchTruckingNumbers } from '../../../integrations/salesCrmActions.js';
import { listApplications, toApplicationsQueryParams } from '../../customerService/applicationsList.js';
import type { Touchpoint } from '../types.js';
import { carrierId, idString, limit, ymdDate } from './common.js';

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
  /**
   * Was `kind: 'deluge'` calling `mytrionGetApplications` — replaced 2026-08-13 with a direct COQL
   * drain (drainApplications/drainDeals in integrations/csApplicationsQuery.ts) + a cached joined
   * snapshot (lib/applicationsSnapshotCache.ts) so sort/filter/search/facets are computed over the
   * WHOLE dataset, not just one loaded page. The Deluge function itself is untouched in Zoho — it
   * has no expressible path for the "Agent (Deal)" filter/sort/facet anyway (that needs a
   * value-based join to the Deals module Deluge can't do any better than COQL could) — and the
   * legacy zoho-octane widget still calls it directly through ZOHO.CRM.FUNCTIONS.execute, so it
   * keeps working (same pattern already used for cs.analytics.maintenance below).
   */
  {
    kind: 'local',
    key: 'cs.applications.list',
    title: 'Applications / Clients table (enriched with Deal + owner data)',
    riskClass: 'read',
    departments: CS_DEPARTMENTS,
    paramsSchema: z.object({
      tab: z.enum(['apps', 'clients']).default('apps'),
      search: z.string().max(300).default(''),
      page: limit(10_000, 1),
      perPage: limit(500, 200),
      sortKey: z.enum(['date', 'appId', 'carrierId']).default('date'),
      sortDir: z.enum(['asc', 'desc']).default('desc'),
      company: z.string().max(200).default(''),
      dateFrom: z.union([ymdDate, z.literal('')]).default(''),
      dateTo: z.union([ymdDate, z.literal('')]).default(''),
      stage: z.string().max(160).default(''),
      biz: z.string().max(160).default(''),
      agent: z.string().max(160).default(''),
      wex: z.array(z.string().max(120)).max(20).default([]),
      loves: z.string().max(40).default(''),
      // Not an x-cache-refresh header — LocalTouchpoint handlers don't see request headers — so a
      // forced refresh (Refresh button / just-saved reload) is threaded through as a param instead.
      fresh: z.boolean().default(false),
    }),
    handler: (ctx, params) => listApplications(ctx, toApplicationsQueryParams(params)),
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
  /**
   * Card-order tracking (QA 2026-08-07) — same Deal-level lookup Sales uses
   * (`carrier.trucking_number_request` in carrierDeluge.ts), but a SEPARATE key rather than adding
   * `customer-service` to that entry's `departments`: that entry keeps `carrierParam`, which routes
   * every non-admin caller through `assertCarrierOwned` — the Sales "own book" DWH-roster check.
   * CS agents have no such book (they look up ANY carrier a client calls about), so widening the
   * shared entry alone still 403'd every CS lookup with "not in your client list". Deliberately NO
   * `carrierParam` here, matching the billing "portfolio role" pattern in serverCrmBilling.ts.
   */
  {
    kind: 'local',
    key: 'cs.carrier.trucking_number_request',
    title: 'Tracking numbers (FedEx card shipments)',
    riskClass: 'read',
    departments: CS_DEPARTMENTS,
    paramsSchema: z.object({ carrierId }),
    handler: (_ctx, params) => fetchTruckingNumbers(String(params.carrierId)),
  },
];
