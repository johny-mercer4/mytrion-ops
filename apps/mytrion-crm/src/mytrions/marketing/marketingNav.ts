/**
 * Marketing Mytrion tabs.
 *
 * Two destinations, so they are real sidebar rows rather than a card hub. Manager's hub exists
 * because its rail is already full (Overview + seven department desks) and its cards have nowhere to
 * live; Marketing has no departments, so a rail whose only row is "Overview" — whose only content is
 * two tiles that are the entire workspace — would cost a click and say nothing.
 *
 * `access` is the Layer-2 gate, open today. When per-tab RBAC lands, narrow the predicate here rather
 * than hiding items in the shell (same contract as hrNav / collectionNav / managerNav).
 */
import type { UserContext } from '../../context/userContext';
import { canSeeTab } from '../../access/resolveAccess';

export type MarketingTabId = 'referrals' | 'loyalty';

export interface MarketingTab {
  id: MarketingTabId;
  label: string;
  /** Sidebar row label — shorter than the page title where the page title is a mouthful. */
  navLabel: string;
  tone: string;
  keywords: string[];
  access: (user: UserContext) => boolean;
}

export const MARKETING_TABS: readonly MarketingTab[] = [
  {
    id: 'referrals',
    label: 'Referral Program',
    navLabel: 'Referral Program',
    tone: 'var(--tone-pink)',
    keywords: ['referral', 'parent', 'child', 'bonus', 'payout', 'records'],
    access: () => true,
  },
  {
    id: 'loyalty',
    label: 'Loyalty Program',
    navLabel: 'Loyalty Program',
    tone: 'var(--tone-amber)',
    keywords: ['loyalty', 'tier', 'gold', 'silver', 'bronze', 'gallons', 'rewards'],
    access: () => true,
  },
];

export function isMarketingTabId(value: string | null | undefined): value is MarketingTabId {
  return value === 'referrals' || value === 'loyalty';
}

export function accessibleMarketingTabs(user: UserContext): MarketingTab[] {
  return MARKETING_TABS.filter((tab) => tab.access(user) && canSeeTab(user, 'marketing', tab.id));
}

/** Guards the view switch, so stale state or a deep link cannot bypass the Layer-2 gate. */
export function canOpenMarketingTab(user: UserContext, id: MarketingTabId): boolean {
  const tab = MARKETING_TABS.find((t) => t.id === id);
  return tab ? tab.access(user) && canSeeTab(user, 'marketing', id) : false;
}
