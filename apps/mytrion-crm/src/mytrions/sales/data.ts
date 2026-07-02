// Seed data + formatting/color helpers for the Sales Mytrion, ported from the
// condensed Sales Mytrion mockup spec (Home / Automations / Inbox / Data
// Center / Create / Carriers / Dashboard). Static fixtures — real Zoho/
// servercrm wiring comes later. Pattern mirrors billing/data.ts.

// ---- Announcements (Home) ----

export type AnnouncementType = 'ai' | 'policy' | 'system' | 'update';

export interface Announcement {
  id: string;
  type: AnnouncementType;
  title: string;
  time: string;
  content: string;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann-1',
    type: 'ai',
    title: 'Mytrion AI now drafts payment-reminder notes',
    time: 'Today, 9:12 AM',
    content:
      'You can now ask Mytrion to draft a payment-reminder note for any carrier carrying a balance. It pulls the latest invoice and outstanding amount automatically.\n\nTry it from the AI Chat tab — just say "draft a reminder for Great Way Logistics".',
  },
  {
    id: 'ann-2',
    type: 'policy',
    title: 'Refund window confirmed at 90 days',
    time: 'Yesterday',
    content:
      'Billing has confirmed the fuel-card overcharge refund window remains 90 days from the transaction date. Verified overcharges are credited to the carrier balance within 3–5 business days.',
  },
  {
    id: 'ann-3',
    type: 'system',
    title: 'EFS portal maintenance Sat 2–4 AM ET',
    time: '2 days ago',
    content:
      'WEX EFS eManager will be unavailable Saturday 2:00–4:00 AM ET for scheduled maintenance. Card activations queued during that window will process automatically afterward.',
  },
  {
    id: 'ann-4',
    type: 'update',
    title: 'New: Card Replacement automation',
    time: '3 days ago',
    content:
      'The Card Replacement block is now live in Automations. For cards on "hold for fraud", the carrier gets two free overnight replacements — the $21.50 shipping fee is waived.',
  },
];

// ---- Today's Snapshot (Home) ----

export interface SnapshotCell {
  label: string;
  value: string;
  tone: 'accent' | 'bad' | 'warn' | 'good' | 'purple';
}

export interface SnapshotGroup {
  title: string;
  cells: SnapshotCell[];
}

export const SNAPSHOT_GROUPS: SnapshotGroup[] = [
  {
    title: 'Your Clients',
    cells: [
      { label: 'Active Customers', value: '47', tone: 'accent' },
      { label: 'Need Attention', value: '6', tone: 'bad' },
      { label: 'Stuck Applications', value: '3', tone: 'warn' },
      { label: 'Money Owed', value: '-$4,820', tone: 'bad' },
    ],
  },
  {
    title: 'This Week',
    cells: [
      { label: 'Fuel Transactions', value: '1,284', tone: 'good' },
      { label: 'Gallons Pumped', value: '38,420', tone: 'purple' },
      { label: 'New Cards', value: '19', tone: 'accent' },
    ],
  },
  {
    title: 'Today',
    cells: [
      { label: 'Fuel Transactions', value: '212', tone: 'accent' },
      { label: 'Gallons Pumped', value: '6,180', tone: 'purple' },
      { label: 'New Cards', value: '4', tone: 'good' },
    ],
  },
];

// ---- Activity (Home) — range toggle ----

export type ActivityRange = 'daily' | 'weekly' | 'monthly';

export interface ActivityStats {
  calls: number;
  notes: number;
  leadsCreated: number;
  leadsReceived: number;
  interested: number;
  applications: number;
  tasksDone: number;
}

export const ACTIVITY_BY_RANGE: Record<ActivityRange, ActivityStats> = {
  daily: { calls: 14, notes: 9, leadsCreated: 3, leadsReceived: 6, interested: 2, applications: 4, tasksDone: 11 },
  weekly: { calls: 86, notes: 52, leadsCreated: 17, leadsReceived: 34, interested: 12, applications: 21, tasksDone: 63 },
  monthly: { calls: 341, notes: 208, leadsCreated: 72, leadsReceived: 146, interested: 51, applications: 89, tasksDone: 274 },
};

export const RANGE_LABEL: Record<ActivityRange, string> = {
  daily: 'Today',
  weekly: 'Week',
  monthly: 'Month',
};

// ---- Call to Action (Home) ----

export interface CallToAction {
  id: string;
  codes: string[];
  name: string;
  desc: string;
  meta: string;
  top: boolean;
}

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

// ---- Automations ----

export interface Automation {
  id: string;
  codes: string[];
  title: string;
  desc: string;
  showRange: boolean;
  procedure?: string;
  comingSoon: boolean;
}

export const AUTOMATIONS: Automation[] = [
  {
    id: 'wex-tasks',
    codes: ['C-2', 'C-19'],
    title: 'Application Update — WEX Tasks',
    desc: 'View latest application updates and WEX task responses for a deal.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'invoices',
    codes: ['C-20', 'Q-1'],
    title: 'Request Invoices',
    desc: 'Browse and download invoices from WorkDrive by date range.',
    showRange: true,
    comingSoon: false,
  },
  {
    id: 'transactions',
    codes: ['C-15'],
    title: 'Transactions Report',
    desc: 'Fetch transaction reports — filter, group, and export to PDF / Excel / CSV.',
    showRange: true,
    comingSoon: false,
  },
  {
    id: 'balance',
    codes: ['C-8'],
    title: 'Balance Check',
    desc: 'View the current account balance for a carrier.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'card-activation',
    codes: ['C-1'],
    title: 'Card Activation',
    desc: 'Activate a new or replacement card — set Unit Number and Driver ID in one step.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'payments',
    codes: ['C-18', 'Q-2'],
    title: 'Check Payment Information',
    desc: 'View payment information by carrier.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'tracking',
    codes: ['C-22'],
    title: 'Tracking Number Request',
    desc: 'Check the card order tracking number and shipment status.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'account-status',
    codes: ['C-28'],
    title: 'Account Status Check',
    desc: 'Combined check across EFS balance, outstanding debt, and EFS card status.',
    showRange: false,
    procedure:
      'Run three checks in order:\n1. EFS — balance (Client Account Fund Transfer screen).\n2. Billing — outstanding debt.\n3. EFS — card status (active / suspended / fraud hold).',
    comingSoon: false,
  },
  {
    id: 'card-replacement',
    codes: ['C-6'],
    title: 'Card Replacement',
    desc: 'Issue replacement cards when a card is marked "hold for fraud".',
    showRange: false,
    procedure:
      'Eligibility: when a card status is "hold for fraud", the customer is entitled to two (2) replacement cards.\nShipping: free overnight delivery — the $21.50 shipping fee is WAIVED.',
    comingSoon: false,
  },
  {
    id: 'fraud-hold',
    codes: ['C-10'],
    title: 'Fraud Hold / Release',
    desc: 'Release a card that is on fraud hold — sends the request to the fraud team.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'billing-form',
    codes: ['Q-11'],
    title: 'Billing Forms',
    desc: 'View submitted billing forms associated with a deal.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'efs-login',
    codes: ['C-12'],
    title: 'EFS Login',
    desc: 'Open the WEX EFS eManager credentials guide.',
    showRange: false,
    comingSoon: false,
  },
  {
    id: 'money-code',
    codes: ['C-17'],
    title: 'Money Code',
    desc: 'Request a money code for a carrier via the ticketing system.',
    showRange: false,
    procedure:
      "Calculation: amount = 20% of the customer's most recent invoice.\nRestrictions: no prior invoice history — an EFS check cannot be issued.",
    comingSoon: true,
  },
];

export function automationById(id: string): Automation | undefined {
  return AUTOMATIONS.find((a) => a.id === id);
}

// ---- Inbox ----

export type InboxType = 'alert' | 'billing' | 'task' | 'lead';
export type InboxPriority = 'critical' | 'high' | 'medium' | 'low' | 'normal';

export interface InboxItem {
  id: string;
  type: InboxType;
  title: string;
  desc: string;
  time: string;
  tag: string;
  priority: InboxPriority;
  unread: boolean;
}

export const INBOX_ITEMS: InboxItem[] = [
  {
    id: 'i1',
    type: 'alert',
    title: 'Card on fraud hold — Great Way Logistics',
    desc: 'EFS flagged card ••••4821 for unusual activity. Carrier is requesting a release. Two free overnight replacements are available.',
    time: '12m ago',
    tag: 'C-10',
    priority: 'critical',
    unread: true,
  },
  {
    id: 'i2',
    type: 'billing',
    title: 'Invoice overdue 14 days — Sunrise Freight',
    desc: 'Invoice Q-10428 for $3,210.00 is 14 days past due. Carrier balance is now -$2,140. Consider a payment reminder.',
    time: '1h ago',
    tag: 'Q-1',
    priority: 'high',
    unread: true,
  },
  {
    id: 'i3',
    type: 'task',
    title: 'Application stuck on BOCA link',
    desc: 'Midwest Haulers application has been waiting on a WEX BOCA task for 22 days. Submit a BOCA Link Request to move it forward.',
    time: '3h ago',
    tag: 'C-27',
    priority: 'medium',
    unread: true,
  },
  {
    id: 'i4',
    type: 'lead',
    title: 'New lead assigned: Iron Range Transport',
    desc: 'A new prospect was routed to you from the Meta campaign. DOT #2284119 · 14 power units · MN.',
    time: 'Today, 8:40 AM',
    tag: 'Lead',
    priority: 'low',
    unread: false,
  },
  {
    id: 'i5',
    type: 'task',
    title: 'Card last-used check requested',
    desc: 'Verification asked for the last-used date on 3 cards tied to Blue Ridge Carriers before closing the account.',
    time: 'Yesterday',
    tag: 'C-24',
    priority: 'normal',
    unread: false,
  },
  {
    id: 'i6',
    type: 'billing',
    title: 'Money code approved — Cardinal Logistics',
    desc: 'Your money code request for $640 (20% of last invoice) was approved by billing.',
    time: 'Yesterday',
    tag: 'C-17',
    priority: 'normal',
    unread: false,
  },
];

// ---- Data Center (Records / clients) ----

export type ClientStatus = 'active' | 'inactive' | 'stuck';

export interface Client {
  id: string; // carrierId
  name: string;
  units: number;
  cards: number;
  status: ClientStatus;
  balance: number; // negative = owed
  gallons: number;
  lastTx: string;
  city: string;
}

export const CLIENTS: Client[] = [
  { id: '98765', name: 'Great Way Logistics Inc', units: 42, cards: 38, status: 'active', balance: -2140, gallons: 14820, lastTx: '2d ago', city: 'Dallas, TX' },
  { id: '88431', name: 'Sunrise Freight LLC', units: 18, cards: 16, status: 'inactive', balance: -980, gallons: 6210, lastTx: '12d ago', city: 'Phoenix, AZ' },
  { id: '77120', name: 'Midwest Haulers Co', units: 9, cards: 7, status: 'stuck', balance: 0, gallons: 0, lastTx: '—', city: 'Chicago, IL' },
  { id: '66902', name: 'Cardinal Logistics', units: 31, cards: 29, status: 'active', balance: 0, gallons: 11240, lastTx: '1d ago', city: 'Atlanta, GA' },
  { id: '65517', name: 'Blue Ridge Carriers', units: 12, cards: 10, status: 'inactive', balance: -1700, gallons: 3110, lastTx: '11d ago', city: 'Knoxville, TN' },
  { id: '64203', name: 'Iron Range Transport', units: 14, cards: 0, status: 'stuck', balance: 0, gallons: 0, lastTx: '—', city: 'Duluth, MN' },
  { id: '63890', name: 'Pacific Drayage Group', units: 27, cards: 25, status: 'active', balance: 0, gallons: 9870, lastTx: 'Today', city: 'Long Beach, CA' },
  { id: '61255', name: 'Summit Express Lines', units: 21, cards: 19, status: 'active', balance: 0, gallons: 8430, lastTx: '3d ago', city: 'Denver, CO' },
];

export function clientById(id: string): Client | undefined {
  return CLIENTS.find((c) => c.id === id);
}

export interface FuelActivityRow {
  station: string;
  date: string;
  gallons: number;
  amount: number;
}

const STATIONS = ['Pilot #4021 — Amarillo, TX', "Love's #612 — Joplin, MO", 'TA #88 — Ontario, CA', 'Flying J #204 — Gary, IN'];

// Synthetic recent-activity rows for the client detail modal — deterministic per
// client (seeded off id) so re-opening the same client shows the same rows.
export function fuelActivityFor(client: Client): FuelActivityRow[] {
  const seed = parseInt(client.id, 10);
  return STATIONS.map((station, i) => {
    const gallons = 80 + ((seed + i * 37) % 140);
    const amount = Math.round(gallons * 3.87 * 100) / 100;
    const daysAgo = i * 2 + 1;
    return { station, date: `${daysAgo}d ago`, gallons, amount };
  });
}

// ---- Create screen (demo tab copy) ----

export type CreateTab = 'ticket' | 'escalation' | 'lead';

// ---- Carriers ----

export type CarrierStatus = 'eligible' | 'active' | 'ineligible';

export interface Carrier {
  id: string; // dot
  name: string;
  units: number;
  status: CarrierStatus;
  phone: string;
  city: string;
  mc: string;
}

export const CARRIERS: Carrier[] = [
  { id: '2284119', name: 'Iron Range Transport', units: 14, status: 'eligible', phone: '(218) 555-0142', city: 'Duluth, MN', mc: 'MC-882140' },
  { id: '1190233', name: 'Cascade Freightways', units: 8, status: 'eligible', phone: '(503) 555-0188', city: 'Portland, OR', mc: 'MC-771902' },
  { id: '3380914', name: 'Lone Star Hauling', units: 22, status: 'active', phone: '(214) 555-0119', city: 'Dallas, TX', mc: 'MC-664310' },
  { id: '2091887', name: 'Great Lakes Cartage', units: 5, status: 'ineligible', phone: '', city: 'Cleveland, OH', mc: 'MC-559021' },
  { id: '4471002', name: 'Sierra Logistics', units: 17, status: 'eligible', phone: '(775) 555-0173', city: 'Reno, NV', mc: 'MC-448820' },
  { id: '1882044', name: 'Delta Freight Systems', units: 31, status: 'active', phone: '(901) 555-0150', city: 'Memphis, TN', mc: 'MC-330194' },
];

export function carrierById(id: string): Carrier | undefined {
  return CARRIERS.find((c) => c.id === id);
}

// ---- formatting ----

export function fmtCurrency(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCompact(n: number): string {
  return n.toLocaleString('en-US');
}

export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Workday progress: 9am–6pm window. Returns 0-100 clamp + a formatted clock label.
export function workdayProgress(now: Date): { pct: number; clock: string } {
  const start = 9;
  const end = 18;
  const hours = now.getHours() + now.getMinutes() / 60;
  const pct = Math.max(0, Math.min(100, ((hours - start) / (end - start)) * 100));
  const clock = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { pct: Math.round(pct), clock };
}

export function statusTone(status: ClientStatus): 'good' | 'warn' | 'bad' {
  if (status === 'active') return 'good';
  if (status === 'inactive') return 'warn';
  return 'bad';
}

export function carrierStatusTone(status: CarrierStatus): 'good' | 'info' | 'neutral' {
  if (status === 'eligible') return 'good';
  if (status === 'active') return 'info';
  return 'neutral';
}

export function carrierStatusLabel(status: CarrierStatus): string {
  if (status === 'eligible') return 'Eligible';
  if (status === 'active') return 'Existing client';
  return 'Ineligible';
}
