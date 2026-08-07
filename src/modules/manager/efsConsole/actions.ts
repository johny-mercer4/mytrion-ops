/**
 * EFS Console — every write endpoint on servercrm's `/api/efs/console/actions`, as data.
 *
 * ALL of them are declared here. Most have no UI yet (`ui: null`), and that is deliberate: the
 * vendor surface belongs in code so it is validated, gated, audited and discoverable, while the
 * button for it only appears on a screen that has actually been built and tested. A test asserts
 * every action in this file is either reachable from a shipped surface or explicitly `ui: null`,
 * so a new servercrm action cannot land here unnoticed.
 *
 * ⚠️ NONE OF THESE HAVE EVER BEEN SENT. The schemas below are read off the vendor documentation,
 * not off a successful call, so treat them as a first draft of the contract rather than a verified
 * one. `FF_MANAGER_EFS_WRITES_ENABLED` is off, and while it is off the dispatcher refuses every
 * action before it reaches servercrm — see dispatch.ts. When arming begins, expect to re-diff
 * these bodies against real responses one action at a time via `MANAGER_EFS_LIVE_ACTIONS`.
 */
import { z } from 'zod';
import type { EfsAction } from './types.js';

/** Carrier ids are digits in both the CMP and DWH domains. */
const carrierId = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().positive()]);
const amount = z.number().positive().finite();
/** EFS dedup key. Required on every funding call so a retry cannot double-move money. */
const refNum = z.string().trim().min(1).max(64);
const cardNumber = z.string().trim().min(1).max(32);
const contractId = z.string().trim().min(1).max(32);

const FUNDING: readonly EfsAction[] = [
  {
    key: 'funding.topup',
    path: '/topup',
    label: 'Top up a carrier',
    group: 'funding',
    riskClass: 'money',
    effect: 'Moves money from the Octane parent account into this carrier’s contract.',
    schema: z.object({ carrierId, contractId, amount, refNum }),
    checks: ['Parent available balance must be at least the amount', 'refNum must not have been used before'],
    ui: null,
  },
  {
    key: 'funding.sweep',
    path: '/sweep',
    label: 'Sweep from a carrier',
    group: 'funding',
    riskClass: 'money',
    effect: 'Pulls money OUT of this carrier’s contract back to the Octane parent account.',
    schema: z.object({ carrierId, contractId, amount, refNum }),
    checks: ['Carrier contract balance must be at least the amount'],
    ui: null,
  },
  {
    key: 'funding.loadToContracts',
    path: '/load-to-contracts',
    label: 'Load to contracts (signed)',
    group: 'funding',
    riskClass: 'money',
    effect: 'Signed load: a positive amount tops up, a negative amount sweeps.',
    schema: z.object({ carrierId, contractId, amount: z.number().finite().refine((v) => v !== 0, 'amount must not be zero'), refNum }),
    ui: null,
  },
  {
    key: 'funding.loadToContractsFromContract',
    path: '/load-to-contracts-from-contract',
    label: 'Load between contracts',
    group: 'funding',
    riskClass: 'money',
    effect: 'Moves money from a named parent contract into a carrier’s contract.',
    schema: z.object({ parentContractId: contractId, carrierId, contractId, amount, refNum }),
    ui: null,
  },
  {
    key: 'funding.loadToCards',
    path: '/load-to-cards',
    label: 'Load to cards',
    group: 'funding',
    riskClass: 'money',
    effect: 'Loads funds directly onto one or more cards.',
    schema: z.object({
      carrierId,
      loads: z.array(z.object({ cardNumber, amount, refNumber: z.string().trim().max(64).optional() })).min(1).max(200),
    }),
    ui: null,
  },
  {
    key: 'funding.loadCash',
    path: '/load-cash',
    label: 'Load cash to a card',
    group: 'funding',
    riskClass: 'money',
    effect: 'Adds a cash balance to one card.',
    schema: z.object({ carrierId, cardNumber, amount, refNumber: z.string().trim().max(64).optional() }),
    checks: ['Card must be ACTIVE in the LIVE card list — never the DWH mart, which lags ~3h'],
    ui: null,
  },
  {
    key: 'funding.loadCashByDriver',
    path: '/load-cash-by-driver',
    label: 'Load cash to a driver',
    group: 'funding',
    riskClass: 'money',
    effect: 'Adds a cash balance to whichever card the driver id resolves to.',
    schema: z.object({ carrierId, driverId: z.string().trim().min(1).max(32), amount, refNumber: z.string().trim().max(64).optional() }),
    ui: null,
  },
];

const MONEY_CODES: readonly EfsAction[] = [
  {
    key: 'moneyCodes.issue',
    path: '/money-codes/issue',
    label: 'Issue a money code',
    group: 'money-codes',
    riskClass: 'money',
    // servercrm makes exactly one attempt and does not retry: a retried issue is a second code.
    effect: 'Creates a NEW redeemable money code. Single attempt — never retried, because a retry issues a second code.',
    schema: z.object({
      carrierId,
      contractId,
      amount,
      refNum: refNum.optional(),
      note: z.string().trim().max(200).optional(),
    }),
    checks: ['Issuing contract must have the amount available'],
    ui: null,
  },
  {
    key: 'moneyCodes.void',
    path: '/money-codes/void',
    label: 'Void a money code',
    group: 'money-codes',
    riskClass: 'destructive',
    effect: 'Cancels an unused money code so it can no longer be redeemed.',
    schema: z.object({ codeId: z.string().trim().min(1).max(64), carrierId: carrierId.optional() }),
    checks: ['Code must be entirely unused (numUses === 0) — servercrm re-checks this before voiding'],
    ui: 'money-codes',
  },
  {
    key: 'moneyCodes.billOnIssue',
    path: '/money-codes/bill-on-issue',
    label: 'Bill-on-issue flag',
    group: 'money-codes',
    riskClass: 'write',
    effect: 'Sets whether a contract is billed at issue time rather than at redemption.',
    schema: z.object({ contractID: contractId, ynFlag: z.enum(['Y', 'N']) }),
    ui: null,
  },
];

const CARDS: readonly EfsAction[] = [
  {
    key: 'cards.set',
    path: '/card',
    label: 'Update a card',
    group: 'cards',
    riskClass: 'write',
    // EFS's setCard is echo-back: it replaces the whole record with what you send, so a partial
    // body silently blanks every field you left out.
    effect: 'Replaces this card’s configuration. EFS echoes back the WHOLE record — omitted fields are cleared, not kept.',
    schema: z.object({
      carrierId,
      cardNumber,
      headerOverrides: z.record(z.unknown()).optional(),
      infos: z.array(z.record(z.unknown())).optional(),
    }),
    checks: ['Card must be ACTIVE in the LIVE card list', 'Body must be built from a freshly fetched card, never from a cached one'],
    ui: 'cards',
  },
  {
    key: 'cards.pin',
    path: '/card-pin',
    label: 'Set a card PIN',
    group: 'cards',
    riskClass: 'write',
    effect: 'Changes the PIN on this card. The driver must be told out of band.',
    schema: z.object({ carrierId, cardNumber, pin: z.string().trim().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits') }),
    checks: ['Card must be ACTIVE in the LIVE card list'],
    ui: 'cards',
  },
  {
    key: 'cards.transfer',
    path: '/card/transfer',
    label: 'Transfer a card',
    group: 'cards',
    riskClass: 'destructive',
    effect: 'Moves a card to a different carrier. The originating carrier loses it.',
    schema: z.object({ carrierId, cardNumber, targetCarrierId: carrierId, params: z.record(z.unknown()).optional() }),
    ui: null,
  },
  {
    key: 'cards.remove',
    path: '/card/remove',
    label: 'Remove a card',
    group: 'cards',
    riskClass: 'destructive',
    effect: 'Permanently removes this card from the carrier.',
    schema: z.object({ carrierId, cardNumber }),
    checks: ['Card balance should be zero — a removed card’s balance is not automatically returned'],
    ui: 'cards',
  },
];

const POLICY: readonly EfsAction[] = [
  {
    key: 'policy.set',
    path: '/policy',
    label: 'Update a policy',
    group: 'policy',
    riskClass: 'write',
    effect: 'Replaces a spending policy. Echo-back, like setCard — send the whole object.',
    schema: z.object({ carrierId, policy: z.record(z.unknown()) }),
    ui: null,
  },
  {
    key: 'policy.create',
    path: '/policy/create',
    label: 'Create a policy',
    group: 'policy',
    riskClass: 'write',
    effect: 'Creates a new spending policy for this carrier.',
    schema: z.object({ carrierId, policy: z.record(z.unknown()).optional() }),
    ui: null,
  },
];

const LOCATIONS: readonly EfsAction[] = [
  {
    key: 'locations.groups',
    path: '/location-groups',
    label: 'Location groups',
    group: 'locations',
    riskClass: 'write',
    effect: 'Creates, edits or deletes a location group, or changes which locations it contains.',
    schema: z.object({
      carrierId,
      action: z.enum(['create', 'set-locs', 'add-locs', 'remove-locs', 'remove', 'set-rule']),
      groupId: z.string().trim().max(64).optional(),
      locations: z.array(z.string().trim().max(64)).optional(),
      rule: z.record(z.unknown()).optional(),
    }),
    ui: null,
  },
];

const ORDERS: readonly EfsAction[] = [
  {
    key: 'orders.create',
    path: '/orders',
    label: 'Create a card order',
    group: 'orders',
    riskClass: 'write',
    effect: 'Creates and submits a new card order. Cards get manufactured and shipped.',
    schema: z.object({ carrierId, newOrderData: z.record(z.unknown()) }),
    ui: null,
  },
  {
    key: 'orders.lifecycle',
    path: '/orders/lifecycle',
    label: 'Order lifecycle',
    group: 'orders',
    riskClass: 'write',
    effect: 'Submits, stops, deletes or edits an existing order.',
    schema: z.object({
      carrierId,
      orderId: z.string().trim().min(1).max(64),
      action: z.enum(['submit', 'stop', 'delete', 'update', 'update-cards']),
      payload: z.record(z.unknown()).optional(),
    }),
    ui: null,
  },
  {
    key: 'orders.replaceLostStolen',
    path: '/orders/replace-lost-stolen',
    label: 'Replace lost / stolen card',
    group: 'orders',
    riskClass: 'write',
    effect: 'Cancels a lost or stolen card and orders a replacement.',
    schema: z.object({ carrierId, cardNumber, params: z.record(z.unknown()).optional() }),
    ui: null,
  },
  {
    key: 'orders.reissueDamaged',
    path: '/orders/reissue-damaged',
    label: 'Reissue damaged card',
    group: 'orders',
    riskClass: 'write',
    effect: 'Orders a replacement for a damaged card.',
    schema: z.object({ carrierId, cardNumber, params: z.record(z.unknown()).optional() }),
    ui: null,
  },
];

const PARENT_CHILD: readonly EfsAction[] = [
  {
    key: 'parentChild.createChild',
    path: '/children',
    label: 'Create a child carrier',
    group: 'parent-child',
    riskClass: 'write',
    effect: 'Creates a NEW carrier under the Octane parent at EFS. It will not be in dim_company until the warehouse syncs.',
    schema: z.object({ carrierDefinition: z.record(z.unknown()) }),
    ui: null,
  },
  {
    key: 'parentChild.assignCards',
    path: '/assign-cards',
    label: 'Assign a card to a child',
    group: 'parent-child',
    riskClass: 'write',
    effect: 'Assigns a card held by the parent to one of its children.',
    schema: z.object({ carrierId, childCarrierId: carrierId, cardNumber }),
    ui: null,
  },
  {
    key: 'parentChild.unlinkChild',
    path: '/unlink-child',
    label: 'Unlink a child carrier',
    group: 'parent-child',
    riskClass: 'destructive',
    effect: 'Detaches a carrier from the Octane parent. It stops being ours at EFS.',
    schema: z.object({ parentId: carrierId, childCarrierId: carrierId }),
    ui: null,
  },
];

const DISCOUNTS: readonly EfsAction[] = [
  {
    key: 'discounts.set',
    path: '/discounts',
    label: 'Set discount eligibility',
    group: 'discounts',
    riskClass: 'money',
    effect: 'Changes which carriers receive the negotiated fuel discount.',
    schema: z.object({
      carrierDiscount: z.array(z.object({ carrier: carrierId, getsDiscount: z.union([z.boolean(), z.enum(['Y', 'N'])]) })).min(1),
    }),
    ui: null,
  },
];

const SMARTPAY: readonly EfsAction[] = [
  {
    key: 'smartpay.manage',
    path: '/smartpay',
    label: 'SmartPay account / schedule',
    group: 'smartpay',
    riskClass: 'money',
    effect: 'Creates or removes a SmartPay account, or changes a payment schedule.',
    schema: z.object({
      carrierId,
      action: z.enum(['set-account', 'delete-account', 'create-schedule', 'update-schedule', 'delete-schedule']),
      payload: z.record(z.unknown()).optional(),
    }),
    ui: null,
  },
  {
    key: 'smartpay.transferAccounts',
    path: '/smartpay/transfer-accounts',
    label: 'Create SmartPay transfer accounts',
    group: 'smartpay',
    riskClass: 'money',
    effect: 'Creates the bank accounts SmartPay transfers run against.',
    schema: z.object({ carrierId, accounts: z.array(z.record(z.unknown())).min(1) }),
    ui: null,
  },
  {
    key: 'smartpay.achTransfer',
    path: '/smartpay/ach-transfer',
    label: 'Immediate ACH transfer',
    group: 'smartpay',
    riskClass: 'money',
    effect: 'Sends an ACH transfer IMMEDIATELY. There is no scheduled window to cancel within.',
    schema: z.object({ carrierId, amount, accountId: z.string().trim().min(1).max(64), refNumber: z.string().trim().max(64).optional() }),
    ui: null,
  },
];

const MILEAGE: readonly EfsAction[] = [
  {
    key: 'mileage.set',
    path: '/mileage',
    label: 'Mileage override',
    group: 'mileage',
    riskClass: 'write',
    effect: 'Overrides or deletes recorded mileage for a set of units.',
    schema: z.object({
      carrierId,
      action: z.enum(['override', 'delete']),
      units: z.array(z.object({ unit: z.string().trim().min(1).max(64), code: z.string().trim().max(16).optional() })).min(1),
    }),
    ui: null,
  },
  {
    key: 'cards.infoLimitCard',
    path: '/info-limit-card',
    label: 'Trip card create / delete',
    group: 'cards',
    riskClass: 'write',
    effect: 'Creates or deletes an info/limit (trip) card.',
    schema: z.object({ carrierId, action: z.enum(['create', 'delete']), payload: z.record(z.unknown()).optional() }),
    ui: null,
  },
];

export const EFS_ACTIONS: readonly EfsAction[] = [
  ...FUNDING,
  ...MONEY_CODES,
  ...CARDS,
  ...POLICY,
  ...LOCATIONS,
  ...ORDERS,
  ...PARENT_CHILD,
  ...DISCOUNTS,
  ...SMARTPAY,
  ...MILEAGE,
];

const BY_KEY = new Map(EFS_ACTIONS.map((a) => [a.key, a]));

export function findAction(key: string): EfsAction | undefined {
  return BY_KEY.get(key);
}
