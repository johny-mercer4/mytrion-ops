/**
 * The "Services" catalog (v2 design) — everything a carrier can do from the mini app, grouped, with
 * a pin-to-Home mechanism. The design prototype derives pin identity by slugifying the (English)
 * label text at render time; that ties persisted pins to copy that i18n makes translatable and thus
 * unstable, so items here carry an explicit, stable `key` instead — pin state should never break
 * just because a label was reworded or translated.
 *
 * `action: null` marks a "soon" item: shown, disabled, not pinnable, no action sheet.
 * `action: 'generic'` opens the generic service-request sheet (see ActionSheet in App.tsx) titled
 * with the item's own label — for requests that don't yet have a dedicated self-service view.
 */
import type { IconName } from '../components/icons';
import type { ServiceKey } from './demo';
import type { ServiceRequestKey } from './api';

export interface CatalogItem {
  key: string;
  labelKey: string;
  icon: IconName;
  action: ServiceKey | 'generic' | null;
  /**
   * Set on a `generic` item to make it file a REAL Zoho Desk ticket instead of the placeholder.
   *
   * Without it, `generic` still runs sendGenericRequest(): a local inbox row reading "Request sent"
   * and no network call whatsoever. The backend map (modules/carrier/serviceRequest.ts) decides who
   * may file each key, so adding one here does not by itself grant a role access.
   */
  request?: ServiceRequestKey;
  /** Shown only to fleet-manager companies — an owner-operator has no team/fleet to manage,
   *  and a row about "drivers" on their screen reads as someone else's app. */
  fleetOnly?: true;
}

export interface CatalogGroup {
  groupLabelKey: string;
  items: CatalogItem[];
}

const DRIVER_CATALOG: CatalogGroup[] = [
  {
    groupLabelKey: 'svcgrp.yourCard',
    items: [
      // No 'drv-status' here: a driver's card standing is already resolved on init and shown on the
      // DriverHero ("Active · Card in good standing"), so a separate "Check card status" action just
      // re-fetched what the home screen already displays.
      //
      // In-group ORDER IS DATA-DRIVEN: the 9-group Telegram support-chat analysis (54k messages,
      // Analitika/servislar_strategiyasi.md) put money codes (2 251 asks, ~30% of everything) and
      // override far ahead of the reads — most-asked first, `soon` items last. Money code is the #1
      // ask, but for a DRIVER it is an owner-authorized action (the money-code backend is owner-only),
      // so it sits in the `soon` block below until a driver→owner approval flow exists — surfacing it
      // as an openable request a driver cannot complete would only dead-end them.
      // "Does my card have money behind it?" — the first question at a declined pump. Boolean-only
      // funds check (shared EFS pool, amount never shown to a driver — see /card/funds).
      { key: 'drv-funds', labelKey: 'cat.drvFunds', icon: 'wallet', action: 'funds' },
      { key: 'drv-override-card', labelKey: 'cat.drvOverrideCard', icon: 'lock', action: 'generic', request: 'override-card' },
      { key: 'drv-txns', labelKey: 'cat.drvTxns', icon: 'list', action: 'txns' },
      // Both of these read data the backend ALREADY scopes to the driver's own card, so neither
      // needed a new endpoint — they were simply missing from the catalog. `last-used` was wired end
      // to end (route, client, renderer) and unreachable for want of this line; the manual entry code
      // is the card number the session already carries, which is why it can render with no fetch.
      { key: 'drv-last-used', labelKey: 'cat.drvLastUsed', icon: 'clock', action: 'lastused' },
      { key: 'drv-reveal-code', labelKey: 'cat.drvRevealCode', icon: 'key', action: 'manualcode' },
      // change-pin is a LIVE action — it must sit above the soon block ("soon items last" is this
      // catalog's own stated rule; it had drifted below two dead rows).
      { key: 'drv-change-pin', labelKey: 'cat.drvChangePin', icon: 'key', action: 'pinunit' },
      // Soon — money code is an owner-authorized action; a driver cannot self-serve it yet.
      { key: 'drv-money-code', labelKey: 'cat.drvMoneyCode', icon: 'banknote', action: null },
      { key: 'drv-hold-unhold', labelKey: 'cat.drvHoldUnhold', icon: 'clock', action: null },
    ],
  },
];

const OWNER_CATALOG: CatalogGroup[] = [
  {
    groupLabelKey: 'svcgrp.finance',
    items: [
      // Demand-ranked (same analysis): money code is the #1 ask by 3×; balance also lives on the
      // home hero, so it does not need the top slot here.
      { key: 'fin-money-code', labelKey: 'cat.finMoneyCode', icon: 'banknote', action: 'moneycode' },
      { key: 'fin-balance', labelKey: 'cat.finBalance', icon: 'wallet', action: 'balance' },
      { key: 'fin-txn-reports', labelKey: 'cat.finTxnReports', icon: 'list', action: 'txns' },
      { key: 'fin-invoice-view', labelKey: 'cat.finInvoiceView', icon: 'doc', action: 'invoices' },
      { key: 'fin-payment-status', labelKey: 'cat.finPaymentStatus', icon: 'card', action: 'payment' },
      { key: 'fin-credit-increase', labelKey: 'cat.finCreditIncrease', icon: 'dollar', action: null },
      { key: 'fin-update-payment-method', labelKey: 'cat.finUpdatePaymentMethod', icon: 'card', action: null },
      { key: 'fin-autopay', labelKey: 'cat.finAutopay', icon: 'refresh', action: null },
      { key: 'fin-payment-link', labelKey: 'cat.finPaymentLink', icon: 'plane', action: null },
      { key: 'fin-add-funds', labelKey: 'cat.finAddFunds', icon: 'wallet', action: null },
    ],
  },
  {
    groupLabelKey: 'svcgrp.cardMgmt',
    items: [
      { key: 'card-activate', labelKey: 'cat.cardActivate', icon: 'card', action: 'cardops' },
      { key: 'card-status', labelKey: 'cat.cardStatus', icon: 'shield', action: 'status' },
      { key: 'card-limit', labelKey: 'cat.cardLimit', icon: 'list', action: 'cardops' },
      { key: 'card-replace', labelKey: 'cat.cardReplace', icon: 'refresh', action: 'generic', request: 'card-replace' },
      { key: 'card-fraud', labelKey: 'cat.cardFraud', icon: 'alert', action: 'generic', request: 'card-fraud' },
      { key: 'card-track', labelKey: 'cat.cardTrack', icon: 'pin', action: 'tracking' },
      // Both of these were `soon` while the backend already supported them: /card/info (C-26)
      // updates unit / driver ID (the pump PIN) / driver name on ANY owner card, and
      // /card/fraud-request (C-10) files the hold/release request. The card-ops sheet carries
      // both flows, so these open it instead of dead-ending on a "soon" chip.
      // Hold/Unhold built but held back from prod (owner decision 2026-07-22) — "soon" until the
      // servercrm HOLD/UNHOLD release; the cardops sheet + backend schema are gated the same way.
      { key: 'card-hold-unhold', labelKey: 'cat.cardHoldUnhold', icon: 'clock', action: null },
      { key: 'card-change-pin', labelKey: 'cat.cardChangePin', icon: 'key', action: 'cardops' },
      // card-order-extra removed — owner decision 2026-07-22: no EFS API for ordering new fleet
      // cards exists, and a bare ticket item is not worth a catalog slot; clients ask their rep.
    ],
  },
  {
    groupLabelKey: 'svcgrp.acctMgmt',
    items: [
      { key: 'acct-manage-drivers', labelKey: 'cat.acctManageDrivers', icon: 'users', action: null, fleetOnly: true },
      // C-7 — the backend request key ('account-reactivate') existed with no catalog entry
      // pointing at it. Reactivation stays a human decision (payment review), so this files
      // the structured CS request rather than flipping anything directly.
      { key: 'acct-reactivate', labelKey: 'cat.acctReactivate', icon: 'refresh', action: 'generic', request: 'account-reactivate' },
      // acct-reset-login removed — owner decision 2026-07-22: the mini-app has no login at all
      // (Telegram initData auth), so this row could never come alive.
      { key: 'acct-close-account', labelKey: 'cat.acctCloseAccount', icon: 'x', action: null },
    ],
  },
  {
    groupLabelKey: 'svcgrp.documents',
    items: [
      { key: 'doc-invoices', labelKey: 'cat.docInvoices', icon: 'doc', action: 'invoices' },
      // Real read now (was a generic ticket): the same servercrm billing-form fetch the CRM
      // widget uses (carrier.billing_form_info), rendered in its own sheet.
      { key: 'doc-billing-form', labelKey: 'cat.docBillingForm', icon: 'doc', action: 'billingform' },
      // doc-ref-guides removed entirely — owner decision 2026-07-22: reference guides are not a
      // client-facing need (the KB is agent SOPs); the agent bot handles how-to questions instead.
      { key: 'doc-maintenance-invoices', labelKey: 'cat.docMaintenanceInvoices', icon: 'doc', action: null },
      { key: 'doc-referral-terms', labelKey: 'cat.docReferralTerms', icon: 'doc', action: null },
    ],
  },
  // The SUPPORT group (find stations / book service / dispute a transaction / talk to an agent)
  // was removed entirely — owner decision 2026-07-21: these are handled by phone call, not the
  // mini-app. A user's stale pin on a removed key is dropped by the Home pin renderer.
];

export function getCatalog(isDriver: boolean, isFleetManager = true): CatalogGroup[] {
  const groups = isDriver ? DRIVER_CATALOG : OWNER_CATALOG;
  if (isDriver || isFleetManager) return groups;
  // Owner-operator: drop fleet-only rows (and any group they empty out).
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.fleetOnly) }))
    .filter((g) => g.items.length > 0);
}

export function defaultPinned(isDriver: boolean): string[] {
  // Demand-ranked (see the catalog-order notes above). Owner: money code is the #1 ask and balance
  // already lives on the home hero, so its pin slot goes to reports instead. Only affects users
  // with no stored pins — a user's own arrangement always wins.
  return isDriver
    ? ['drv-funds', 'drv-override-card', 'drv-txns'] // not drv-money-code: it is a `soon` (owner-authorized) item for drivers, so it isn't pinnable
    : ['fin-money-code', 'card-status', 'fin-txn-reports', 'fin-invoice-view'];
}

export function findCatalogItem(key: string, isDriver: boolean): { item: CatalogItem; groupLabelKey: string } | undefined {
  for (const g of getCatalog(isDriver)) {
    const item = g.items.find((i) => i.key === key);
    if (item) return { item, groupLabelKey: g.groupLabelKey };
  }
  return undefined;
}
