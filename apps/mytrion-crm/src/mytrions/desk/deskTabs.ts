/** Mytrion Desk tabs. React-free — see the note in admin/adminTabs.ts for why. */
import type { TabDescriptor } from '../../access/tabRegistry';

export const DESK_TABS = [
  { key: 'tickets', label: 'Tickets' },
  { key: 'escalations', label: 'Escalations' },
  { key: 'analytics', label: 'Analytics' },
  // Admin-only in the shell (`admin ? [settings] : []`). Declared anyway — the registry answers
  // "what exists", the shell answers "may you see it", and a tab absent from the registry could
  // never be granted at all.
  { key: 'settings', label: 'Routing' },
] as const satisfies readonly TabDescriptor[];

export type DeskTabKey = (typeof DESK_TABS)[number]['key'];
