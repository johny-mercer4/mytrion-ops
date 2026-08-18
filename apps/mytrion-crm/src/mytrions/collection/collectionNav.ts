/**
 * Collection Mytrion navigation — a flat tab set: Home, Array Reports, Collection Cases.
 *
 * RBAC is layered. Layer 1 is entering the Mytrion (`canAccess` in resolveAccess, driven by the
 * access table). Layer 2 is `access(user)` per tab here. Both only shape the UI — the endpoint is
 * the security boundary, gated on the `collection` department the same way Manager gates on
 * `management` and Finance on `finance`.
 *
 * Cases and Array read the finder-owned Postgres snapshots through `/v1/collection/*`.
 */
import type { LucideIcon } from 'lucide-react';
import { Home, LayoutGrid, Sheet } from 'lucide-react';
import type { UserContext } from '../../context/userContext';
import { canSeeTab } from '../../access/resolveAccess';

export type CollectionTabId = 'home' | 'array' | 'cases';

export interface CollectionTab {
  id: CollectionTabId;
  label: string;
  /** One line on the tab's page head — what a collector comes here to do. */
  description: string;
  icon: LucideIcon;
  /** Wayfinding hue, from the shared --tone-* scale (see styles/horizon.css). */
  tone: string;
  keywords: string[];
  /** Not wired to a live source yet — renders <ComingSoon /> and the nav shows a badge. */
  soon?: boolean;
  /** Layer-2 gate: may THIS user open the tab? Default: any Collection-level user. */
  access: (user: UserContext) => boolean;
}

export const COLLECTION_TABS: CollectionTab[] = [
  {
    id: 'home',
    label: 'Home',
    description: 'Recovery at a glance, and the way in to everything else.',
    icon: Home,
    tone: 'var(--tone-rose)',
    keywords: ['overview', 'hub', 'recovery'],
    access: () => true,
  },
  {
    id: 'array',
    label: 'Array Reports',
    description: 'Filings sent to the Array agency and what came back from them.',
    icon: Sheet,
    tone: 'var(--tone-amber)',
    keywords: ['agency', 'filing', 'array', 'report', 'placement'],
    access: () => true,
  },
  {
    id: 'cases',
    label: 'Collection Cases',
    description: 'Bad-debt escalation from hand-off through contact, plan and recovery.',
    icon: LayoutGrid,
    tone: 'var(--tone-sky)',
    keywords: ['bad debt', 'escalation', 'recovery', 'case', 'plan'],
    access: () => true,
  },
];

/** Tabs this user may open (Layer-2 filtered) — drives the sidebar. */
export function accessibleCollectionTabs(user: UserContext): CollectionTab[] {
  return COLLECTION_TABS.filter((t) => t.access(user) && canSeeTab(user, 'collection', t.id));
}

/** Layer-2 check for a single tab — guards the view switch so stale state can't bypass the sidebar. */
export function canOpenCollectionTab(user: UserContext, id: CollectionTabId): boolean {
  const tab = COLLECTION_TABS.find((t) => t.id === id);
  return tab ? tab.access(user) && canSeeTab(user, 'collection', id) : false;
}

export function findCollectionTab(id: CollectionTabId): CollectionTab {
  // COLLECTION_TABS covers every id, so this is total; the fallback satisfies the type checker.
  return COLLECTION_TABS.find((t) => t.id === id) ?? COLLECTION_TABS[0]!;
}
