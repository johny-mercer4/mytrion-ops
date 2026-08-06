/**
 * EFS Console — every read endpoint on servercrm's `/api/efs/console/fetchers`, as data.
 *
 * Latency values are measured, not guessed (prod, 2026-08-06):
 *   parent/snapshot 1.8s · carrier/snapshot 1.1s · carrier/transactions(6d) 1.6s
 *   money-codes/summary(30d) 3.9s · carrier/cards(37 cards) 5.0s · parent/discounts 11.1s
 * Nothing in this console may fan out on mount. Every panel is fetched when its tab is opened,
 * with its own skeleton, exactly as modules/finance/financeEfs.ts already established.
 */
import { z } from 'zod';
import type { EfsFetcher } from './types.js';
import { redactMoneyCodeDetail, redactMoneyCodes } from './redact.js';

const carrierIds = z.object({
  carrierIds: z.array(z.union([z.string().regex(/^\d{1,20}$/), z.number().int().positive()])).min(1).max(500),
});

/** Parent-side reads: the account Octane itself holds at EFS. */
const PARENT: readonly EfsFetcher[] = [
  {
    key: 'parent.snapshot',
    side: 'parent',
    path: '/parent/snapshot',
    method: 'GET',
    label: 'Parent balance & contracts',
    window: 'none',
    health: 'ok',
    latency: 'slow',
  },
  {
    key: 'parent.carrierInfo',
    side: 'parent',
    path: '/parent/carrier-info',
    method: 'GET',
    label: 'Parent carrier info',
    window: 'none',
    health: 'ok',
    latency: 'slow',
  },
  {
    key: 'parent.discounts',
    side: 'parent',
    path: '/parent/discounts',
    method: 'GET',
    label: 'Discount eligibility',
    window: 'none',
    health: 'ok',
    // 11.1s against prod. The slowest read in the catalog by a factor of two.
    latency: 'very-slow',
  },
  {
    key: 'parent.transactions',
    side: 'parent',
    path: '/parent/transactions',
    method: 'GET',
    label: 'All child transactions',
    window: 'txn7d',
    health: 'ok',
    query: ['from', 'to', 'carrierId'],
    latency: 'very-slow',
  },
  {
    key: 'parent.carrierTransactions',
    side: 'parent',
    path: '/parent/carriers/:carrierId/transactions',
    method: 'GET',
    label: 'One child’s transactions (parent view)',
    window: 'txn7d',
    health: 'ok',
    pathParams: ['carrierId'],
    query: ['from', 'to'],
    latency: 'slow',
  },
  {
    key: 'parent.childRejects',
    side: 'parent',
    path: '/parent/child-rejects',
    method: 'GET',
    label: 'Child transaction rejects',
    window: 'txn7d',
    health: 'ok',
    query: ['from', 'to', 'carrierId'],
    latency: 'slow',
  },
  {
    key: 'parent.registeredChecks',
    side: 'parent',
    path: '/parent/registered-checks',
    method: 'GET',
    label: 'Registered checks',
    window: 'history90d',
    health: 'ok',
    query: ['from', 'to'],
    latency: 'slow',
  },
  {
    key: 'parent.childrenByCreationDate',
    side: 'parent',
    path: '/children/by-creation-date',
    method: 'GET',
    label: 'Children created in window',
    window: 'history90d',
    health: 'ok',
    query: ['from', 'to'],
    latency: 'slow',
  },
  {
    key: 'parent.childrenByIds',
    side: 'parent',
    path: '/children/by-ids',
    // A read that takes a body. base.ts never retries POSTs, so the dispatcher retries this one
    // manually — it is semantically a GET.
    method: 'POST',
    label: 'Balances for a set of children',
    window: 'none',
    health: 'ok',
    bodySchema: carrierIds,
    latency: 'slow',
  },
  {
    key: 'moneyCodes.list',
    side: 'parent',
    path: '/money-codes',
    method: 'GET',
    label: 'Money code history',
    window: 'history90d',
    health: 'ok',
    query: ['from', 'to', 'status', 'carrierId', 'v2'],
    redact: redactMoneyCodes,
    latency: 'very-slow',
  },
  {
    key: 'moneyCodes.detail',
    side: 'parent',
    path: '/money-codes/detail',
    method: 'GET',
    label: 'One money code',
    window: 'none',
    health: 'ok',
    query: ['codeId', 'alphaCode'],
    redact: redactMoneyCodeDetail,
    latency: 'slow',
  },
  {
    key: 'moneyCodes.summary',
    side: 'parent',
    path: '/money-codes/summary',
    method: 'GET',
    label: 'Money code totals',
    window: 'history90d',
    health: 'ok',
    query: ['from', 'to'],
    latency: 'slow',
  },
  {
    key: 'moneyCodes.use',
    side: 'parent',
    path: '/money-codes/use',
    method: 'GET',
    label: 'Money code redemptions',
    window: 'history90d',
    health: 'ok',
    query: ['contractId', 'from', 'to'],
    latency: 'slow',
  },
  {
    key: 'loads.byCarrier',
    side: 'carrier',
    path: '/loads/:carrierId',
    method: 'GET',
    label: 'Top-ups & sweeps',
    window: 'history90d',
    health: 'ok',
    pathParams: ['carrierId'],
    query: ['from', 'to', 'direction'],
    latency: 'slow',
  },
  {
    key: 'loads.bulk',
    side: 'parent',
    path: '/loads/bulk',
    method: 'POST',
    label: 'Top-ups & sweeps, many carriers',
    window: 'history90d',
    health: 'ok',
    bodySchema: carrierIds.extend({
      from: z.string().optional(),
      to: z.string().optional(),
      direction: z.enum(['TOPUP', 'SWEEP', 'ALL']).optional(),
    }),
    latency: 'very-slow',
  },
];

/**
 * Carrier-side reads. Every one is scoped to a carrier that must exist in octane.dim_company.
 *
 * Written as partials and completed by the `.map` at the end — `side`, `method` and `health` are
 * the same on all 35, and repeating them would bury the three rows where `health` is NOT ok.
 */
type CarrierPartial = Omit<EfsFetcher, 'side' | 'method' | 'health'> & Partial<Pick<EfsFetcher, 'health'>>;

const CARRIER: readonly EfsFetcher[] = ([
  { key: 'carrier.snapshot', path: '/carrier/:carrierId/snapshot', label: 'Balance, contracts & cards', window: 'none', latency: 'slow' },
  { key: 'carrier.cards', path: '/carrier/:carrierId/cards', label: 'Card summaries', window: 'none', latency: 'very-slow' },
  { key: 'carrier.card', path: '/carrier/:carrierId/cards/:cardNumber', label: 'One card in full', window: 'none', latency: 'slow', pathParams: ['cardNumber'], query: ['v2'] },
  { key: 'carrier.cardDescriptions', path: '/carrier/:carrierId/cards/descriptions', label: 'Card descriptions', window: 'none', latency: 'slow' },
  { key: 'carrier.cardRefreshingLimits', path: '/carrier/:carrierId/cards/:cardNumber/refreshing-limits', label: 'Refreshing limits', window: 'none', latency: 'slow', pathParams: ['cardNumber'] },
  { key: 'carrier.cardValid', path: '/carrier/:carrierId/cards/:cardNumber/valid', label: 'Validate card PIN / driver', window: 'none', latency: 'slow', pathParams: ['cardNumber'], query: ['pin', 'driverId'] },
  { key: 'carrier.cardsNoDriverId', path: '/carrier/:carrierId/cards/no-driver-id', label: 'Cards without a driver id', window: 'none', latency: 'slow' },
  { key: 'carrier.cardsByDriver', path: '/carrier/:carrierId/cards/by-driver/:driverId', label: 'Cards for a driver', window: 'none', latency: 'slow', pathParams: ['driverId'] },
  { key: 'carrier.transactions', path: '/carrier/:carrierId/transactions', label: 'Fuel transactions', window: 'txn7d', latency: 'slow', query: ['from', 'to'] },
  { key: 'carrier.txnSummary', path: '/carrier/:carrierId/txn-summary', label: 'Transaction totals', window: 'txn7d', latency: 'slow', query: ['from', 'to'] },
  {
    key: 'carrier.rejects',
    path: '/carrier/:carrierId/rejects',
    label: 'Declined transactions',
    window: 'txn7d',
    latency: 'slow',
    query: ['from', 'to', 'cardNum', 'invoice', 'locationId'],
    health: 'broken',
    brokenReason:
      'EFS rejects every date format for this call (ADBException: Unexpected subelement startDate). Confirmed broken upstream 2026-08-04 and 2026-08-06. Use the parent-side child-rejects view instead.',
  },
  { key: 'carrier.cash', path: '/carrier/:carrierId/cash', label: 'Cash balances', window: 'none', latency: 'slow', query: ['cardNumbers'] },
  { key: 'carrier.cashHistory', path: '/carrier/:carrierId/cash-history', label: 'Cash history', window: 'history90d', latency: 'very-slow', query: ['from', 'to', 'cardNumber', 'cardNumbers'] },
  { key: 'carrier.payrollCash', path: '/carrier/:carrierId/payroll-cash', label: 'Payroll cash', window: 'none', latency: 'slow', query: ['cardNumber'] },
  { key: 'carrier.payrollCashHistory', path: '/carrier/:carrierId/payroll-cash-history', label: 'Payroll cash history', window: 'txn7d', latency: 'very-slow', query: ['from', 'to', 'cardNumber'] },
  { key: 'carrier.policies', path: '/carrier/:carrierId/policies', label: 'Policies', window: 'none', latency: 'slow' },
  { key: 'carrier.policy', path: '/carrier/:carrierId/policy/:policyNumber', label: 'One policy', window: 'none', latency: 'slow', pathParams: ['policyNumber'] },
  { key: 'carrier.sitePolicies', path: '/carrier/:carrierId/site-policies', label: 'Site policies', window: 'none', latency: 'slow' },
  { key: 'carrier.mileage', path: '/carrier/:carrierId/mileage', label: 'Mileage units', window: 'none', latency: 'slow', query: ['units'] },
  { key: 'carrier.products', path: '/carrier/:carrierId/products', label: 'Products', window: 'none', latency: 'slow' },
  { key: 'carrier.productGroups', path: '/carrier/:carrierId/product-groups', label: 'Product groups', window: 'none', latency: 'slow' },
  { key: 'carrier.promptTypes', path: '/carrier/:carrierId/prompt-types', label: 'Prompt types', window: 'none', latency: 'slow' },
  { key: 'carrier.locationsSearch', path: '/carrier/:carrierId/locations/search', label: 'Location search', window: 'none', latency: 'slow', query: ['q', 'state', 'city'] },
  { key: 'carrier.geoPrices', path: '/carrier/:carrierId/geo-prices', label: 'Geo prices', window: 'none', latency: 'slow' },
  { key: 'carrier.interstatePrices', path: '/carrier/:carrierId/interstate-prices', label: 'Interstate prices', window: 'none', latency: 'slow' },
  { key: 'carrier.locationGroups', path: '/carrier/:carrierId/location-groups', label: 'Location groups', window: 'none', latency: 'slow' },
  { key: 'carrier.locationGroup', path: '/carrier/:carrierId/location-groups/:groupId', label: 'One location group', window: 'none', latency: 'slow', pathParams: ['groupId'] },
  { key: 'carrier.transLocations', path: '/carrier/:carrierId/trans-locations', label: 'Transaction locations', window: 'none', latency: 'slow', query: ['cardNumber', 'policyNumber'] },
  { key: 'carrier.orders', path: '/carrier/:carrierId/orders', label: 'Card orders', window: 'history90d', latency: 'slow', query: ['from', 'to'] },
  { key: 'carrier.order', path: '/carrier/:carrierId/orders/:orderId', label: 'One order', window: 'none', latency: 'slow', pathParams: ['orderId'] },
  { key: 'carrier.orderCards', path: '/carrier/:carrierId/orders/:orderId/cards', label: 'Cards on an order', window: 'none', latency: 'slow', pathParams: ['orderId'] },
  { key: 'carrier.orderMeta', path: '/carrier/:carrierId/orders/meta', label: 'Order metadata', window: 'none', latency: 'slow' },
  { key: 'carrier.smartpayAccounts', path: '/carrier/:carrierId/smartpay/accounts', label: 'SmartPay accounts', window: 'none', latency: 'slow', query: ['cardNumber'] },
  { key: 'carrier.smartpayScheduled', path: '/carrier/:carrierId/smartpay/scheduled', label: 'SmartPay scheduled', window: 'none', latency: 'slow' },
  { key: 'carrier.smartpayHistory', path: '/carrier/:carrierId/smartpay/history', label: 'SmartPay history', window: 'history90d', latency: 'slow', query: ['from', 'to'] },
] satisfies readonly CarrierPartial[]).map((f) => ({
  side: 'carrier' as const,
  method: 'GET' as const,
  health: 'ok' as const,
  ...f,
}));

export const EFS_FETCHERS: readonly EfsFetcher[] = [...PARENT, ...CARRIER];

const BY_KEY = new Map(EFS_FETCHERS.map((f) => [f.key, f]));

export function findFetcher(key: string): EfsFetcher | undefined {
  return BY_KEY.get(key);
}
