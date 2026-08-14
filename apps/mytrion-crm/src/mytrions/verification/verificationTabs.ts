/** Verification Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why. */
import type { TabDescriptor } from '../../access/tabRegistry';

export const VERIFICATION_TABS = [
  { key: 'main', label: 'Overview' },
  { key: 'cases', label: 'Verification cases' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'ruleset', label: 'Ruleset' },
  { key: 'clients', label: 'Clients' },
  { key: 'tickets', label: 'Tickets' },
] as const satisfies readonly TabDescriptor[];

export type VerificationTabKey = (typeof VERIFICATION_TABS)[number]['key'];
