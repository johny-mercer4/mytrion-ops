/**
 * Billing Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why.
 *
 * `billing/Shell.tsx` derives its `SectionId` from `BillingTabKey`, so adding an entry here is a
 * compile error until the shell supplies an icon and a panel for it.
 */
import type { TabDescriptor } from '../../access/tabRegistry';

export const BILLING_TABS = [
  { key: 'datacenter', label: 'Data Center', group: 'Money' },
  { key: 'transactions', label: 'Transactions', group: 'Money' },
  { key: 'ledger', label: 'Ledger', group: 'Money' },

  { key: 'debtors', label: 'Debtors', group: 'Recovery' },
  { key: 'prepay', label: 'Prepay', group: 'Recovery' },
  { key: 'returns', label: 'Returns', group: 'Recovery' },

  // Parked in the shell (TICKETS_PARKED). Still declared and still grantable: `soon` is a
  // build-status flag, not a permission, and the two compose rather than substituting for each other.
  { key: 'tickets', label: 'Tickets', group: 'Comms', soon: true },
] as const satisfies readonly TabDescriptor[];

export type BillingTabKey = (typeof BILLING_TABS)[number]['key'];
