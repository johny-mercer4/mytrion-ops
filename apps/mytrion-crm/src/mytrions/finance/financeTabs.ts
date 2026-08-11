/** Finance Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why. */
import type { TabDescriptor } from '../../access/tabRegistry';

export const FINANCE_TABS = [
  { key: 'home', label: 'Home' },
  { key: 'clients', label: 'Clients' },
] as const satisfies readonly TabDescriptor[];

export type FinanceTabKey = (typeof FINANCE_TABS)[number]['key'];
