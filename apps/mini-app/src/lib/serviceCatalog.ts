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
      // override far ahead of the reads — most-asked first, `soon` items last.
      { key: 'drv-money-code', labelKey: 'cat.drvMoneyCode', icon: 'banknote', action: 'generic', request: 'money-code' },
      { key: 'drv-override-card', labelKey: 'cat.drvOverrideCard', icon: 'lock', action: 'generic', request: 'override-card' },
      { key: 'drv-txns', labelKey: 'cat.drvTxns', icon: 'list', action: 'txns' },
      // Both of these read data the backend ALREADY scopes to the driver's own card, so neither
      // needed a new endpoint — they were simply missing from the catalog. `last-used` was wired end
      // to end (route, client, renderer) and unreachable for want of this line; the manual entry code
      // is the card number the session already carries, which is why it can render with no fetch.
      { key: 'drv-last-used', labelKey: 'cat.drvLastUsed', icon: 'clock', action: 'lastused' },
      { key: 'drv-reveal-code', labelKey: 'cat.drvRevealCode', icon: 'key', action: 'manualcode' },
      { key: 'drv-hold-unhold', labelKey: 'cat.drvHoldUnhold', icon: 'clock', action: null },
      { key: 'drv-change-pin', labelKey: 'cat.drvChangePin', icon: 'key', action: null },
    ],
  },
];

const OWNER_CATALOG: CatalogGroup[] = [
  {
    groupLabelKey: 'svcgrp.finance',
    items: [
      // Demand-ranked (same analysis): money code is the #1 ask by 3×; balance also lives on the
      // home hero, so it does not need the top slot here.
      { key: 'fin-money-code', labelKey: 'cat.finMoneyCode', icon: 'banknote', action: 'generic', request: 'money-code' },
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
      { key: 'card-activate', labelKey: 'cat.cardActivate', icon: 'card', action: 'generic', request: 'card-activate' },
      { key: 'card-status', labelKey: 'cat.cardStatus', icon: 'shield', action: 'status' },
      { key: 'card-limit', labelKey: 'cat.cardLimit', icon: 'list', action: 'generic', request: 'card-limit' },
      { key: 'card-replace', labelKey: 'cat.cardReplace', icon: 'refresh', action: 'generic', request: 'card-replace' },
      { key: 'card-fraud', labelKey: 'cat.cardFraud', icon: 'alert', action: 'generic', request: 'card-fraud' },
      { key: 'card-track', labelKey: 'cat.cardTrack', icon: 'pin', action: 'tracking' },
      { key: 'card-hold-unhold', labelKey: 'cat.cardHoldUnhold', icon: 'clock', action: null },
      { key: 'card-change-pin', labelKey: 'cat.cardChangePin', icon: 'key', action: null },
      { key: 'card-order-extra', labelKey: 'cat.cardOrderExtra', icon: 'card', action: null },
    ],
  },
  {
    groupLabelKey: 'svcgrp.acctMgmt',
    items: [
      { key: 'acct-manage-drivers', labelKey: 'cat.acctManageDrivers', icon: 'users', action: null },
      { key: 'acct-reset-login', labelKey: 'cat.acctResetLogin', icon: 'lock', action: null },
      { key: 'acct-close-account', labelKey: 'cat.acctCloseAccount', icon: 'x', action: null },
    ],
  },
  {
    groupLabelKey: 'svcgrp.documents',
    items: [
      { key: 'doc-invoices', labelKey: 'cat.docInvoices', icon: 'doc', action: 'invoices' },
      { key: 'doc-billing-form', labelKey: 'cat.docBillingForm', icon: 'doc', action: 'generic', request: 'billing-form' },
      { key: 'doc-ref-guides', labelKey: 'cat.docRefGuides', icon: 'doc', action: 'generic', request: 'ref-guides' },
      { key: 'doc-maintenance-invoices', labelKey: 'cat.docMaintenanceInvoices', icon: 'doc', action: null },
      { key: 'doc-referral-terms', labelKey: 'cat.docReferralTerms', icon: 'doc', action: null },
    ],
  },
  {
    groupLabelKey: 'svcgrp.support',
    items: [
      // Demand-ranked `soon` queue: stations (814 asks — the "supported truck stops" list is pasted
      // into chats weekly) and roadside/service booking (757) are worth un-parking first.
      { key: 'sup-find-stations', labelKey: 'cat.supFindStations', icon: 'pin', action: null },
      { key: 'sup-book-service', labelKey: 'cat.supBookService', icon: 'truck', action: null },
      { key: 'sup-dispute-txn', labelKey: 'cat.supDisputeTxn', icon: 'alert', action: null },
      { key: 'sup-talk-agent', labelKey: 'cat.supTalkAgent', icon: 'headset', action: null },
    ],
  },
];

export function getCatalog(isDriver: boolean): CatalogGroup[] {
  return isDriver ? DRIVER_CATALOG : OWNER_CATALOG;
}

export function defaultPinned(isDriver: boolean): string[] {
  // Demand-ranked (see the catalog-order notes above). Owner: money code is the #1 ask and balance
  // already lives on the home hero, so its pin slot goes to reports instead. Only affects users
  // with no stored pins — a user's own arrangement always wins.
  return isDriver
    ? ['drv-money-code', 'drv-txns']
    : ['fin-money-code', 'card-status', 'fin-txn-reports', 'fin-invoice-view'];
}

export function findCatalogItem(key: string, isDriver: boolean): { item: CatalogItem; groupLabelKey: string } | undefined {
  for (const g of getCatalog(isDriver)) {
    const item = g.items.find((i) => i.key === key);
    if (item) return { item, groupLabelKey: g.groupLabelKey };
  }
  return undefined;
}
