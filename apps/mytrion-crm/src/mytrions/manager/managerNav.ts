/**
 * Manager Mytrion cards — the "wizard" grid of hub blocks. Each card opens its own page. This is the
 * SECOND RBAC layer: Layer 1 is entering the Manager Mytrion (canAccess); Layer 2 is `access(user)`
 * per card here. This gate only shapes the UI — the backend endpoint behind each card is the real
 * security boundary (Referrals → `management`-gated `/v1/manager/referrals/*`).
 */
import type { LucideIcon } from 'lucide-react';
import { Share2 } from 'lucide-react';
import type { UserContext } from '../../context/userContext';

/** Add a card id here as new hub blocks land (payouts, approvals, KPIs, …). */
export type ManagerCardId = 'referrals';

export interface ManagerCard {
  id: ManagerCardId;
  label: string;
  /** Short chip shown on the card + sidebar. */
  tag: string;
  description: string;
  icon: LucideIcon;
  /** Layer-2 gate: may THIS user open the card? Default: any Manager-level user. */
  access: (user: UserContext) => boolean;
}

export const MANAGER_CARDS: ManagerCard[] = [
  {
    id: 'referrals',
    label: 'Referrals',
    tag: 'CRM',
    description: 'Parent & child referral records from Zoho — full fields and details.',
    icon: Share2,
    // Open to anyone who can enter Manager. To restrict later: access: (u) => isAdmin(u).
    access: () => true,
  },
];

/** Cards this user may open (Layer-2 filtered) — drives both the home grid and the sidebar nav. */
export function accessibleManagerCards(user: UserContext): ManagerCard[] {
  return MANAGER_CARDS.filter((card) => card.access(user));
}

/** Layer-2 check for a single card — guards the view switch so a stale state can't bypass the grid. */
export function canOpenManagerCard(user: UserContext, id: ManagerCardId): boolean {
  const card = MANAGER_CARDS.find((c) => c.id === id);
  return card ? card.access(user) : false;
}
