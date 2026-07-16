/**
 * Customer Service Mytrion Deluge touchpoints — the read surface of the old
 * zoho-octane/app/mytrion-customer-service widget. Unwrap modes mirror each function's
 * verified envelope (see the widget panels + scripts/standalone/*.dg in zoho-octane):
 *  - mytrionGetApplications / mytrionbillingdatacenterdeals return {status:'success', …}
 *    envelopes whose siblings (more_records/page, total_deals/is_delta) the UI needs →
 *    'status' (validates and returns the WHOLE payload).
 *  - mytrionGetHomeMetrics has no reliable success wrapper; the widget only rejects an
 *    explicit status:'error' → 'cardAction'.
 *  - mytrionGetMaintenanceAnalytics returns {success, data, error?} → 'successFlag'.
 * Writes (Applications save, Citifuel CRUD, Data Center deal edits) are NOT touchpoints —
 * they run through the /cs/* routes with field-casing resolution and auditing.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { idString, limit, ymdDate } from './common.js';

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
    paramsSchema: z.object({
      tab: z.enum(['apps', 'clients']).default('apps'),
      search: z.string().max(300).optional().default(''),
      page: limit(10_000, 1).transform(String),
      perPage: limit(200, 200).transform(String),
    }),
  },
  {
    kind: 'deluge',
    key: 'cs.analytics.maintenance',
    title: 'Maintenance analytics (CRM Maintenance module, period vs period)',
    riskClass: 'read',
    departments: CS_DEPARTMENTS,
    functionNames: ['mytrionGetMaintenanceAnalytics'],
    unwrap: 'successFlag',
    paramsSchema: z.object({
      fromDate: ymdDate,
      toDate: ymdDate,
      prevFromDate: ymdDate,
      prevToDate: ymdDate,
    }),
  },
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
