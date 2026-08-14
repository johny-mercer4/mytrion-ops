/** Verification Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why. */
import type { TabDescriptor } from '../../access/tabRegistry';

export const VERIFICATION_TABS = [
  { key: 'main', label: 'Main' },
  { key: 'inbox', label: 'Inbox', group: 'Queue' },
  { key: 'cases', label: 'Verification cases', group: 'Queue' },
  { key: 'ruleset', label: 'Decision rules', group: 'Policy' },
  { key: 'clients', label: 'Existing clients', group: 'Roster' },
  { key: 'tickets', label: 'Tickets', group: 'Roster', soon: true },
] as const satisfies readonly TabDescriptor[];

export type VerificationTabKey = (typeof VERIFICATION_TABS)[number]['key'];
