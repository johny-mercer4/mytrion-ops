/**
 * Collection Mytrion navigation — TWO sections, not one flat tab set.
 *
 * The old set was Home / Array Reports / Collection Cases, flat. The names and the grant KEYS are
 * unchanged — `home`, `cases`, `array` — so no permission set is orphaned by this redesign. What
 * changed is what Home IS (a launcher became the worklist) and the addition of `queue`: the filed
 * Metro 2 book and the queue of work in front of it are two jobs on two clocks, and only the book
 * had a screen.
 *
 * RBAC is layered. Layer 1 is entering the Mytrion (`canAccess` in resolveAccess, driven by the
 * access table). Layer 2 is `access(user)` per tab here. Both only shape the UI — the endpoint is
 * the security boundary, gated on the `collection` department the same way Manager gates on
 * `management` and Finance on `finance`.
 */
import type { LucideIcon } from 'lucide-react';
import { LayoutGrid, Send, Sheet, Target } from 'lucide-react';
import type { UserContext } from '../../context/userContext';
import { canSeeTab } from '../../access/resolveAccess';

export type CollectionTabId = 'home' | 'cases' | 'queue' | 'array';

/** The rail's two groups. Order here is order on screen. */
export type CollectionSectionId = 'desk' | 'agency';

export interface CollectionTab {
  id: CollectionTabId;
  section: CollectionSectionId;
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

export const COLLECTION_SECTIONS: ReadonlyArray<{ id: CollectionSectionId; label: string }> = [
  { id: 'desk', label: 'Desk' },
  { id: 'agency', label: 'Agency' },
];

export const COLLECTION_TABS: CollectionTab[] = [
  {
    id: 'home',
    section: 'desk',
    label: 'Home',
    description: 'Everything the desk owes an action on, ordered by the recovery at risk.',
    icon: Target,
    tone: 'var(--tone-rose)',
    keywords: ['worklist', 'queue', 'promises', 'today', 'home', 'overview'],
    access: () => true,
  },
  {
    id: 'cases',
    section: 'desk',
    label: 'Collection Cases',
    description: 'The whole bad-debt book, from hand-off through contact, plan and recovery.',
    icon: LayoutGrid,
    tone: 'var(--tone-sky)',
    keywords: ['bad debt', 'escalation', 'recovery', 'case', 'plan', 'board'],
    access: () => true,
  },
  {
    id: 'queue',
    section: 'agency',
    label: 'Placement queue',
    description: 'What is ready to file with Array, what is blocked, and on which Metro 2 field.',
    icon: Send,
    tone: 'var(--tone-amber)',
    keywords: ['array', 'placement', 'agency', 'metro 2', 'file', 'dob'],
    access: () => true,
  },
  {
    id: 'array',
    section: 'agency',
    label: 'Array Reports',
    description: 'Metro 2 tradelines placed with Array — a snapshot, not the live Zoho write.',
    icon: Sheet,
    tone: 'var(--tone-violet)',
    keywords: ['array', 'report', 'tradeline', 'filing', 'snapshot', 'period'],
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

/**
 * The first tab this user may open. `home` for everyone who can see it — a desk should land on
 * the work, not on the first thing that happens to be permitted.
 */
export function defaultCollectionTab(user: UserContext): CollectionTabId {
  const tabs = accessibleCollectionTabs(user);
  return tabs.find((t) => t.id === 'home')?.id ?? tabs[0]?.id ?? 'home';
}
