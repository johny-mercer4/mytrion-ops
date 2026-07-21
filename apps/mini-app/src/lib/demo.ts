/**
 * Inbox item shape. The feed is now backend-driven (news + notifications via `lib/api.ts` →
 * `fetchInboxFeed`); the demo seed was removed so a fresh account shows a real, empty inbox rather
 * than fabricated rows. These types stay here because both App.tsx and InboxTab consume them.
 */
import type { IconName } from '../components/icons';

/** The 7 canonical self-service sheets. */
export type ServiceKey = 'balance' | 'funds' | 'status' | 'txns' | 'invoices' | 'payment' | 'lastused' | 'tracking' | 'manualcode' | 'moneycode' | 'cardops' | 'pinunit';

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
