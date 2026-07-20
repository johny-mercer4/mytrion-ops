/**
 * Sales Mytrion static catalogs (action config only — no carrier/deal seed data).
 * Live rows come from touchpoints / Desk via redesign/live.ts and friends.
 */

export interface CallToAction {
  id: string;
  codes: string[];
  name: string;
  desc: string;
  meta: string;
  top: boolean;
}

/** Home Quick Actions — links into Automations (not fake CRM records). */
export const CALL_TO_ACTIONS: CallToAction[] = [
  {
    id: 'cta-wex-tasks',
    codes: ['C-2', 'C-19'],
    name: 'Application Update — WEX Tasks',
    desc: 'Review application update requests and WEX task responses directly from the automations panel.',
    meta: 'Top CS request',
    top: true,
  },
  {
    id: 'cta-invoices',
    codes: ['C-20', 'Q-1'],
    name: 'Request Invoices',
    desc: 'Fetch carrier invoices by date range and download the exact files agents need from WorkDrive.',
    meta: 'Top billing request',
    top: true,
  },
];
