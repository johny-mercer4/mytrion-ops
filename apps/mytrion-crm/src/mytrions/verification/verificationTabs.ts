/**
 * Verification Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why.
 *
 * DECLARING A TAB IS NOT COSMETIC. `canSeeTab` reads a user's tab grant and shows only the keys in
 * it, and the admin picker builds those grants from THIS list — so a tab the shell renders but this
 * file omits is invisible to every non-admin who has a verification permission set. That is how the
 * rebuilt Inbox shipped hidden: it renders in `index.tsx` and was not declared here.
 *
 * The remaining legacy credit-platform tabs (Verification cases, Decision rules) are still NOT
 * declared while `legacyDesk.ts` has them off, for the opposite reason: `tabRegistry.test.ts` asserts
 * every declared key is actually rendered, and a declared-but-unmounted tab is a permission set
 * granted for a screen nobody can open. Their components remain on disk and come back with the flag.
 */
import type { TabDescriptor } from '../../access/tabRegistry';

export const VERIFICATION_TABS = [
  { key: 'main', label: 'Main' },
  { key: 'inbox', label: 'Inbox', group: 'Queue' },
  { key: 'applicants', label: 'Verification Case', group: 'Queue' },
  { key: 'data-center', label: 'Data Center', group: 'Queue' },
  { key: 'watch', label: 'Mytrion Watch', group: 'Queue' },
  { key: 'clients', label: 'Existing clients', group: 'Roster' },
  { key: 'tickets', label: 'Tickets', group: 'Roster', soon: true },
] as const satisfies readonly TabDescriptor[];

export type VerificationTabKey = (typeof VERIFICATION_TABS)[number]['key'];

const LIVE_TAB_KEYS: ReadonlySet<string> = new Set(
  VERIFICATION_TABS.filter((tab) => !('soon' in tab && tab.soon === true)).map((tab) => tab.key),
);

/** `?tab=data-center` (or any live key). Unknown / Soon keys fall back to Main. */
export function verificationViewFromSearch(search: string): VerificationTabKey {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const tab = new URLSearchParams(raw).get('tab');
  if (tab && LIVE_TAB_KEYS.has(tab)) return tab as VerificationTabKey;
  return 'main';
}
