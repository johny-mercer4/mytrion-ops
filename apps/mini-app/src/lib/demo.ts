/**
 * The inbox feed is still demo-seeded (no backend notification stream yet). The 7 self-service
 * sheets (balance, transactions, invoices, payment, last-used, tracking) now fetch real data via
 * `lib/api.ts` — see `ActionSheet` in App.tsx.
 */
import type { IconName } from '../components/icons';

/** The 7 canonical self-service sheets. */
export type ServiceKey = 'balance' | 'status' | 'txns' | 'invoices' | 'payment' | 'lastused' | 'tracking' | 'manualcode';

export type InboxCategory = 'news' | 'notifications';

export interface InboxItem {
  id: string;
  category: InboxCategory;
  icon: IconName;
  /** CSS color value, or null to fall back to the theme's link-accent tint. */
  color: string | null;
  /** i18n key for the notification title (inbox.*) — ignored if `titleText` is set. */
  titleKey: string;
  /** Pre-resolved literal title, for notifications built at runtime (e.g. a generic service request) rather than seeded from a fixed key. */
  titleText?: string;
  /** i18n key for the notification body (inbox.*) — ignored if `bodyText` is set. */
  bodyKey: string;
  /** Pre-resolved literal body, see `titleText`. */
  bodyText?: string;
  /** Interpolation vars for `bodyKey` (e.g. {card}/{company}) — unused if `bodyText` is set. */
  bodyParams?: Record<string, string>;
  /** i18n key for the relative time (time.*), with optional {n}. */
  atKey: string;
  atN?: number;
  /** Minutes since the notification fired — ground truth for date sorting; `atKey`/`atN` are display-only. */
  minutesAgo: number;
  unread: boolean;
}

export function seedInbox(isDriver: boolean, ownCard: string, company: string): InboxItem[] {
  if (isDriver) {
    return [
      { id: 'n1', category: 'notifications', icon: 'card', color: 'var(--success)', titleKey: 'inbox.cardActivated.title', bodyKey: 'inbox.cardActivated.body', bodyParams: { card: ownCard }, atKey: 'time.hour', atN: 2, minutesAgo: 120, unread: true },
      { id: 'n2', category: 'notifications', icon: 'pin', color: null, titleKey: 'inbox.cardDelivered.title', bodyKey: 'inbox.cardDelivered.body', bodyParams: { company }, atKey: 'time.yesterday', minutesAgo: 1440, unread: false },
    ];
  }
  return [
    { id: 'n1', category: 'notifications', icon: 'doc', color: null, titleKey: 'inbox.newInvoice.title', bodyKey: 'inbox.newInvoice.body', atKey: 'time.hour', atN: 1, minutesAgo: 60, unread: true },
    { id: 'n2', category: 'notifications', icon: 'clock', color: 'var(--destructive)', titleKey: 'inbox.paymentDue.title', bodyKey: 'inbox.paymentDue.body', atKey: 'time.hour', atN: 3, minutesAgo: 180, unread: true },
    { id: 'n3', category: 'notifications', icon: 'check', color: 'var(--success)', titleKey: 'inbox.paymentReceived.title', bodyKey: 'inbox.paymentReceived.body', atKey: 'time.yesterday', minutesAgo: 1440, unread: false },
  ];
}
