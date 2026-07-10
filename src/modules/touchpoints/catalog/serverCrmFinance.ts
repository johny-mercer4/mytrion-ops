/**
 * Finance Mytrion servercrm touchpoints — the read-only REST surface the legacy
 * mytrion-finance widget consumed (transactions, smart-balance audits, clients,
 * payments, debtors, analytics/segments). Department-gated to 'finance'.
 *
 * List endpoints take a bounded passthrough filter map (looseFilters): the widget
 * forwarded panel filters verbatim and servercrm owns/validates the vocabulary.
 * Finance sees ALL clients (no per-agent carrier ownership — unlike the sales entries),
 * matching the widget's org-wide static-key access.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { carrierId, limit, looseFilters } from './common.js';

const FINANCE = ['finance'] as const;

/** GET list endpoint whose whole param set is a loose filter map. */
function financeList(key: string, title: string, pathTemplate: string): Touchpoint {
  return {
    kind: 'servercrm',
    key,
    title,
    riskClass: 'read',
    departments: FINANCE,
    method: 'GET',
    pathTemplate,
    paramsSchema: looseFilters(),
  };
}

export const serverCrmFinanceTouchpoints: Touchpoint[] = [
  financeList('finance.main_transactions', 'Main transactions (list)', '/api/main-transactions'),
  financeList('finance.main_transactions_count', 'Main transactions (count)', '/api/main-transactions/count'),
  financeList('finance.smart_audits', 'Smart Balance audits (list)', '/api/smart-balance/audits'),
  financeList('finance.smart_audits_count', 'Smart Balance audits (count)', '/api/smart-balance/audits/count'),
  financeList('finance.clients', 'Clients (org-wide list)', '/api/clients'),
  financeList('finance.clients_count', 'Clients (count)', '/api/clients/count'),
  financeList('finance.payments', 'Payments (list)', '/api/payments'),
  financeList('finance.payments_count', 'Payments (count)', '/api/payments/count'),
  financeList('finance.debtors', 'Debtors (list)', '/api/debtors'),
  financeList('finance.debtors_count', 'Debtors (count)', '/api/debtors/count'),
  financeList('finance.analytics_fueling', 'Fueling patterns (org-wide)', '/api/analytics/fueling-patterns'),
  financeList('finance.analytics_segments_aggregate', 'Client segments (aggregate)', '/api/analytics/segments/aggregate'),
  financeList('finance.analytics_segments_clients', 'Client segments (clients)', '/api/analytics/segments/clients'),
  financeList('finance.analytics_clients_fueling_on', 'Clients fueling on a given day', '/api/analytics/clients-fueling-on'),
  {
    kind: 'servercrm',
    key: 'finance.analytics_fueling_carrier',
    title: 'Fueling patterns (single carrier)',
    riskClass: 'read',
    departments: FINANCE,
    method: 'GET',
    pathTemplate: '/api/analytics/fueling-patterns/{carrierId}',
    // passthrough: remaining panel filters ride the query string (read-only upstream).
    paramsSchema: z.object({ carrierId }).passthrough(),
  },
  // Client drilldowns — same servercrm paths as the sales entries, but WITHOUT the
  // per-agent ownership gate (finance is org-wide) and finance-department scoped.
  {
    kind: 'servercrm',
    key: 'finance.client_invoices',
    title: 'Client invoices (finance drilldown)',
    riskClass: 'read',
    departments: FINANCE,
    method: 'GET',
    pathTemplate: '/api/clients/{carrierId}/invoices',
    paramsSchema: z.object({ carrierId, limit: limit(500, 100).optional() }),
  },
  {
    kind: 'servercrm',
    key: 'finance.client_payments',
    title: 'Client payment transactions (finance drilldown)',
    riskClass: 'read',
    departments: FINANCE,
    method: 'GET',
    pathTemplate: '/api/clients/{carrierId}/payment-transactions',
    paramsSchema: z.object({ carrierId, limit: limit(500, 100).optional() }),
  },
  {
    kind: 'servercrm',
    key: 'finance.client_recent_transactions',
    title: 'Client recent fuel transactions (finance drilldown)',
    riskClass: 'read',
    departments: FINANCE,
    method: 'GET',
    pathTemplate: '/api/clients/{carrierId}/recent-transactions',
    paramsSchema: z.object({ carrierId, limit: limit(200, 30).optional() }),
  },
];
