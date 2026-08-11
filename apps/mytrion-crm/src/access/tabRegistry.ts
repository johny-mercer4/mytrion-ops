/**
 * Every tab in every Mytrion, in one place.
 *
 * WHY THIS EXISTS. Permission sets are granted down to tab level and the requirement is that they be
 * DYNAMIC — "whenever we add the tab or update the mytrion", user management picks it up with no
 * second edit. Before this, nothing enumerated tabs across workspaces: five of them kept their list
 * as a module-local `const` inside a component file, and the backend's taxonomy stopped at the
 * Mytrion. A picker had nothing to render.
 *
 * SHAPE, AND WHY NOT THE ALTERNATIVES.
 *
 * Each Mytrion owns its own declaration in a sibling module and this file only composes them. A
 * single hand-written list here would fail "dynamic" in the worst possible way — adding a tab would
 * need two edits in two directories and the one you forget is the invisible one. Codegen was
 * rejected because it would have to parse JSX evaluated at module scope (verification/index.tsx
 * holds `content: <VerificationClients />`) and closures over component state (admin/index.tsx
 * builds its nav INSIDE the component, over `tab` and `setTab`).
 *
 * What keeps it in step is two mechanisms, neither of which relies on remembering:
 *
 *   TYPES pin the vocabulary. Each `*Tabs.ts` is `as const satisfies readonly TabDescriptor[]` and
 *   exports a key union; its shell derives its own tab-id type from that union. So the shell and the
 *   registry cannot disagree about what a key IS — renaming one end fails to compile at the other.
 *   This does NOT make a brand-new descriptor a compile error: the shells consume the union through
 *   `active === id` comparisons and a `Partial<Record<…>>`, neither of which is exhaustive.
 *
 *   TESTS cover the rest. `tabRegistry.test.ts` asserts every declared key actually appears in its
 *   workspace's sources, so a phantom entry cannot reach the picker as a grantable tab that does not
 *   exist. The opposite direction — a tab the shell renders but nobody declared — is caught by a
 *   dev-only warning in MytrionShell, and it is the genuinely bad state: an unregistered key can
 *   never be granted, so it is permanently invisible to anyone holding a scoped set.
 *
 * REACT-FREE, DELIBERATELY. This module is imported by the Admin chunk. If a `*Tabs.ts` imported a
 * component, the registry would drag every workspace's data layer in with it, and `admin/index.tsx`
 * would end up importing itself. Icons are not part of a descriptor for the same reason — the picker
 * renders labelled checkboxes.
 *
 * NOT A SECURITY BOUNDARY. Tab grants are UI gating only; the backend enforces at Mytrion +
 * read/full and nothing finer. See the header of resolveAccess.ts.
 */
import { MYTRION_ORDER, type MytrionId } from './mytrions.config';

import { ADMIN_TABS } from '../mytrions/admin/adminTabs';
import { BILLING_TABS } from '../mytrions/billing/billingTabs';
import { CS_TABS } from '../mytrions/customer-service/csTabs';
import { FINANCE_TABS } from '../mytrions/finance/financeTabs';
import { RECRUIT_TABS } from '../mytrions/recruit/recruitTabs';
import { VERIFICATION_TABS } from '../mytrions/verification/verificationTabs';
import { TRAILHEAD_TABS } from '../mytrions/trailhead/trailheadTabs';
import { MARKETING_TAB_DESCRIPTORS } from '../mytrions/marketing/marketingTabs';
import { HR_TABS } from '../mytrions/hr/hrNav';
import { COLLECTION_TABS } from '../mytrions/collection/collectionNav';
import { MANAGER_CARDS, MANAGER_DEPARTMENTS } from '../mytrions/manager/managerNav';
import { ANALYTICS_CATEGORIES } from '../mytrions/analyst/categories';
import { NAV as SALES_NAV } from '../mytrions/sales/redesign/salesData';

export interface TabDescriptor {
  /**
   * Stable and unique WITHIN its Mytrion — this is the grant key, stored in the database.
   *
   * The namespace is per-Mytrion, not global: `home` exists in six workspaces and means six
   * different destinations, so a grant is always keyed on the PAIR (mytrionId, key). Renaming a key
   * orphans every grant that names it, which the editor surfaces rather than silently pruning.
   */
  key: string;
  label: string;
  /**
   * Picker grouping, mirroring the shell's own NavSection label so an admin configuring permissions
   * sees the structure the user sees. Manager's "General" vs "Departments" split is the case this
   * exists for — it is exactly the distinction the requirement called out.
   */
  group?: string;
  /** Not built yet. Grantable regardless: `soon` is a build status, a grant is a permission. */
  soon?: boolean;
}

/** Adapts an already-exported nav array whose entries carry `id`/`label`. */
function fromNav(
  items: readonly { id: string; label: string; comingSoon?: boolean }[],
  group?: string,
): TabDescriptor[] {
  return items.map((i) => ({
    key: i.id,
    label: i.label,
    ...(group === undefined ? {} : { group }),
    ...(i.comingSoon === true ? { soon: true } : {}),
  }));
}

/**
 * Manager keeps two separate arrays and the requirement names both: "a lot of workspaces (general)
 * and department workspaces — they should be controllable". `group` is what carries that into the
 * picker as two independently select-all-able fieldsets.
 *
 * Card ids and department ids are disjoint today, so one flat keyspace is safe; tabRegistry.test.ts
 * asserts that, because a future `sales` CARD would otherwise collide with the `sales` DEPARTMENT
 * and one grant would silently control both.
 */
const MANAGER_TABS: TabDescriptor[] = [
  ...MANAGER_CARDS.map((c) => ({ key: c.id, label: c.label, group: 'General' })),
  ...MANAGER_DEPARTMENTS.map((d) => ({ key: d.id, label: d.navLabel, group: 'Departments' })),
];

export const MYTRION_TABS: Record<MytrionId, readonly TabDescriptor[]> = {
  admin: ADMIN_TABS,
  sales: fromNav(SALES_NAV),
  billing: BILLING_TABS,
  collection: fromNav(COLLECTION_TABS),
  finance: FINANCE_TABS,
  verification: VERIFICATION_TABS,
  manager: MANAGER_TABS,
  marketing: MARKETING_TAB_DESCRIPTORS,
  analyst: fromNav(ANALYTICS_CATEGORIES),
  hr: fromNav(HR_TABS),
  recruit: RECRUIT_TABS,
  trailhead: TRAILHEAD_TABS,
  'customer-service': CS_TABS,
};

/** The tabs a Mytrion declares, or `[]` for an id with no registry entry. */
export function tabsFor(id: MytrionId): readonly TabDescriptor[] {
  return MYTRION_TABS[id] ?? [];
}

/** `(mytrionId, key)` → descriptor. Used by the editor to label a stored grant. */
export function findTab(id: MytrionId, key: string): TabDescriptor | undefined {
  return tabsFor(id).find((t) => t.key === key);
}

/**
 * Stored grant keys that no longer name a real tab.
 *
 * Never auto-pruned. A rename that silently dropped grants would be unrecoverable and invisible; the
 * editor renders these as greyed "no longer exists" chips with an explicit Remove instead. The
 * server cannot compute this — the registry is client-side, deliberately — so the editor diffs.
 */
export function unknownTabKeys(id: MytrionId, keys: readonly string[]): string[] {
  const known = new Set(tabsFor(id).map((t) => t.key));
  return keys.filter((k) => !known.has(k));
}

/** Every (Mytrion, tab) pair, in picker order. */
export function allTabs(): { mytrion: MytrionId; tab: TabDescriptor }[] {
  return MYTRION_ORDER.flatMap((id) => tabsFor(id).map((tab) => ({ mytrion: id, tab })));
}
