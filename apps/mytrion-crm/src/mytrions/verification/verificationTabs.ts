/**
 * Verification Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why.
 *
 * The legacy credit-platform tabs (Inbox, Verification cases, Decision rules) are NOT declared here
 * while `legacyDesk.ts` has them off. `tabRegistry.test.ts` asserts every declared key is actually
 * rendered by this Mytrion, so declaring a tab the shell will not mount would fail the suite — and
 * a permission set could be granted for a tab nobody can open.
 *
 * Their components remain on disk, quarantined, and come back with the flag.
 */
import type { TabDescriptor } from '../../access/tabRegistry';

export const VERIFICATION_TABS = [
  { key: 'main', label: 'Main' },
  { key: 'applicants', label: 'New applicants', group: 'Queue' },
  { key: 'watch', label: 'Mytrion Watch', group: 'Queue' },
  { key: 'clients', label: 'Existing clients', group: 'Roster' },
  { key: 'tickets', label: 'Tickets', group: 'Roster', soon: true },
] as const satisfies readonly TabDescriptor[];

export type VerificationTabKey = (typeof VERIFICATION_TABS)[number]['key'];
