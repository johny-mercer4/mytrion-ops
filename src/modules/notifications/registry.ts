/**
 * THE single source of notification routing truth (see Analitika/notification_system_ultraplan.md
 * §1.1): type → allowed roles → template → dedupe window. Callers never hand-roll "who gets
 * this"; the dispatcher enforces it — the same rule as the mini-app's server-side gates ("a
 * missing button is not the gate").
 *
 * Driver deliveries additionally require the event's payload.cardId to equal the driver's own
 * registered card (fail-closed in the dispatcher) — a driver only ever hears about THEIR card.
 */
export type MiniAppNotificationRole = 'owner' | 'driver';

export interface MiniAppNotificationSpec {
  roles: readonly MiniAppNotificationRole[];
  /** i18n template key in templates.ts. */
  templateKey: string;
}

export const NOTIFICATION_TYPES = {
  /** C-17 draw completed. The CODE VALUE is never in the message — "open the mini-app". */
  money_code: { roles: ['owner'], templateKey: 'moneyCode' },
  /** Card status changed (Hold/Inactive/Active) — owner: all cards; driver: own card. */
  card_status: { roles: ['owner', 'driver'], templateKey: 'cardStatus' },
  /** Daily gallons approaching/at limit. Gallons visible; dollar figures never (driver rule). */
  limit: { roles: ['owner', 'driver'], templateKey: 'limit' },
  /** Weekly statement document — company finances, owner only. */
  statement: { roles: ['owner'], templateKey: 'statement' },
  /** Fueling receipt from a new mart txn row. Place + gallons; no price for drivers. */
  receipt: { roles: ['owner', 'driver'], templateKey: 'receipt' },
  /** Override succeeded (the former inline bot receipt, now through the outbox). */
  override: { roles: ['owner', 'driver'], templateKey: 'override' },
  /** Faza-3.3 driver money-code ask → owner confirm. Inline buttons only on the owner copy. */
  approval: { roles: ['owner', 'driver'], templateKey: 'approval' },
  /** Debt/payment reminder before hard-debtor. Owner only. */
  debt: { roles: ['owner'], templateKey: 'debt' },
  /** Card shipment tracking updates. Owner only. */
  tracking: { roles: ['owner'], templateKey: 'tracking' },
  /** Prepay EFS balance under threshold. Owner only (drivers get the boolean funds view). */
  balance_low: { roles: ['owner'], templateKey: 'balanceLow' },
  /** News post with severity=important — the bot copy of an inbox announcement. */
  news: { roles: ['owner', 'driver'], templateKey: 'news' },
} as const satisfies Record<string, MiniAppNotificationSpec>;

export type MiniAppNotificationType = keyof typeof NOTIFICATION_TYPES;
