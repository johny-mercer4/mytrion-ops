/** Marketing Mytrion tabs. React-free — see the note in admin/adminTabs.ts for why. */
import type { TabDescriptor } from '../../access/tabRegistry';

export const MARKETING_TAB_DESCRIPTORS = [
  { key: 'referrals', label: 'Referral Program', group: 'Programs' },
  { key: 'loyalty', label: 'Loyalty Program', group: 'Programs' },
] as const satisfies readonly TabDescriptor[];
