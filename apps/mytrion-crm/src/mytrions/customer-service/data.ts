// Seed data + formatting/color helpers for the Customer Service Mytrion, ported
// from the Customer Service mockup's condensed spec (applications, CITI Fuel
// clients, analytics). Static fixtures — real Zoho Desk/CRM wiring comes later.

export type Business = 'LLC' | 'Corporation' | 'Sole Proprietorship' | 'Partnership';
export type PayType = 'LOC' | 'Deposit' | 'Prepay' | '';

export interface Application {
  id: string;
  appId: string;
  company: string;
  first: string;
  last: string;
  biz: Business;
  stage: string;
  wex: string;
  mc: string;
  dot: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  credit: number | null;
  trucks: number;
  cards: number;
  date: string;
  agent: string;
  notes: string;
  cycle: string;
  pay: PayType;
  ta: 0 | 1;
  efs: 0 | 1;
  lmt: 0 | 1;
  mob: 0 | 1;
  chn: 0 | 1;
  verified: boolean;
  carrierId: string;
}

export const APPLICATIONS: Application[] = [
  { id: 'a1', appId: 'APP-20482', company: 'Ridgeline Freight LLC', first: 'Marcus', last: 'Bell', biz: 'LLC', stage: 'Adjudication', wex: 'Pending Decision', mc: 'MC-882140', dot: '2841902', phone: '4155550142', email: 'ops@ridgelinefrt.com', city: 'Reno', state: 'NV', credit: 712, trucks: 14, cards: 12, date: 'Jun 24, 2025', agent: 'Priya Nair', notes: 'Waiting on updated insurance COI before adjudication sign-off.', cycle: '1 Billing Cycle', pay: 'LOC', ta: 1, efs: 1, lmt: 0, mob: 0, chn: 0, verified: false, carrierId: '' },
  { id: 'a2', appId: 'APP-20475', company: 'Cobalt Line Carriers', first: 'Dana', last: 'Suh', biz: 'Corporation', stage: 'Credit Follow-up', wex: 'Additional Authentication Required', mc: 'MC-771003', dot: '3120558', phone: '2135550188', email: 'ap@cobaltline.com', city: 'Fresno', state: 'CA', credit: 648, trucks: 8, cards: 6, date: 'Jun 23, 2025', agent: 'Marcus Cole', notes: 'Credit thin-file — requested 2 trade references.', cycle: '2 Billing Cycle', pay: 'Deposit', ta: 1, efs: 0, lmt: 0, mob: 0, chn: 0, verified: false, carrierId: '' },
  { id: 'a3', appId: 'APP-20510', company: 'Harbor Point Logistics', first: 'Elena', last: 'Ross', biz: 'LLC', stage: 'Application', wex: 'Saved-Complete', mc: 'MC-905221', dot: '3390114', phone: '7025550176', email: 'dispatch@harborpt.com', city: 'Henderson', state: 'NV', credit: null, trucks: 22, cards: 18, date: 'Jun 27, 2025', agent: 'Priya Nair', notes: '', cycle: '', pay: 'Prepay', ta: 0, efs: 0, lmt: 0, mob: 0, chn: 0, verified: false, carrierId: '' },
  { id: 'a4', appId: 'APP-20455', company: 'Sierra Haul Co', first: 'Tom', last: 'Alvarez', biz: 'Sole Proprietorship', stage: 'EFS Processing', wex: 'Decisioned', mc: 'MC-660928', dot: '2775410', phone: '3235550119', email: 'tom@sierrahaul.com', city: 'Bakersfield', state: 'CA', credit: 701, trucks: 5, cards: 4, date: 'Jun 20, 2025', agent: 'Wei Zhang', notes: 'EFS ticket opened; awaiting card production window.', cycle: '1 Billing Cycle', pay: 'LOC', ta: 1, efs: 1, lmt: 1, mob: 0, chn: 0, verified: false, carrierId: '' },
  { id: 'a5', appId: 'APP-20498', company: 'Granite State Transport', first: 'Nadia', last: 'Khan', biz: 'Corporation', stage: 'Adjudication', wex: 'Pending Setup Data', mc: 'MC-814772', dot: '3055891', phone: '6035550133', email: 'billing@granitest.com', city: 'Manchester', state: 'NH', credit: 689, trucks: 11, cards: 10, date: 'Jun 25, 2025', agent: 'Marcus Cole', notes: 'Setup data incomplete on WEX portal — nudged applicant.', cycle: '2 Billing Cycle', pay: 'Deposit', ta: 1, efs: 1, lmt: 0, mob: 0, chn: 0, verified: false, carrierId: '' },
  { id: 'a6', appId: 'APP-20441', company: 'Redwood Freightways', first: 'Sam', last: 'Ortiz', biz: 'Partnership', stage: 'Credit Follow-up', wex: 'Deposit Counter Offer Sent', mc: 'MC-559013', dot: '2410778', phone: '5035550164', email: 'accounts@redwoodfw.com', city: 'Salem', state: 'OR', credit: 634, trucks: 7, cards: 6, date: 'Jun 19, 2025', agent: 'Wei Zhang', notes: 'Counter-offer deposit sent; awaiting acceptance.', cycle: '', pay: 'Deposit', ta: 1, efs: 0, lmt: 0, mob: 0, chn: 0, verified: false, carrierId: '' },
  { id: 'a7', appId: 'APP-20521', company: 'Blue Mesa Trucking', first: 'Rachel', last: 'Long', biz: 'LLC', stage: 'Application', wex: 'Saved-Incomplete', mc: 'MC-931200', dot: '3401552', phone: '4805550151', email: 'rachel@bluemesa.com', city: 'Mesa', state: 'AZ', credit: null, trucks: 3, cards: 2, date: 'Jun 28, 2025', agent: 'Priya Nair', notes: '', cycle: '', pay: 'Prepay', ta: 0, efs: 0, lmt: 0, mob: 0, chn: 0, verified: false, carrierId: '' },
  { id: 'c1', appId: 'APP-20330', company: 'Ironhide Logistics LLC', first: 'Owen', last: 'Pratt', biz: 'LLC', stage: 'Cards Activated', wex: 'Cards Produced', mc: 'MC-448210', dot: '2210983', phone: '4155550190', email: 'ops@ironhidelog.com', city: 'Sacramento', state: 'CA', credit: 734, trucks: 26, cards: 24, date: 'Jun 05, 2025', agent: 'Marcus Cole', notes: 'Fully onboarded — monitoring first billing cycle.', cycle: '1 Billing Cycle', pay: 'LOC', ta: 1, efs: 1, lmt: 1, mob: 1, chn: 1, verified: true, carrierId: '104882' },
  { id: 'c2', appId: 'APP-20288', company: 'Cedar Ridge Transport', first: 'Lily', last: 'Munoz', biz: 'Corporation', stage: 'Card Funded', wex: 'Cards Produced', mc: 'MC-390771', dot: '2098443', phone: '6155550172', email: 'ap@cedarridge.com', city: 'Nashville', state: 'TN', credit: 766, trucks: 19, cards: 16, date: 'May 29, 2025', agent: 'Wei Zhang', notes: 'Prepay account funded and active.', cycle: '2 Billing Cycle', pay: 'Prepay', ta: 1, efs: 1, lmt: 1, mob: 1, chn: 0, verified: true, carrierId: '205513' },
  { id: 'c3', appId: 'APP-20355', company: 'Summit Line Haul', first: 'Grace', last: 'Yoon', biz: 'LLC', stage: 'Billing Form Filled', wex: 'Cards Produced', mc: 'MC-501224', dot: '2660118', phone: '8015550129', email: 'dispatch@summitline.com', city: 'Provo', state: 'UT', credit: 698, trucks: 9, cards: 8, date: 'Jun 12, 2025', agent: 'Priya Nair', notes: 'Billing form complete; verification pending.', cycle: '1 Billing Cycle', pay: 'Deposit', ta: 1, efs: 1, lmt: 1, mob: 0, chn: 0, verified: false, carrierId: '330219' },
  { id: 'c4', appId: 'APP-20301', company: 'Vanguard Carriers LLC', first: 'Ben', last: 'Frost', biz: 'LLC', stage: 'Card Swiped', wex: 'Cards Produced', mc: 'MC-420669', dot: '1998221', phone: '3125550143', email: 'ops@vanguardcarr.com', city: 'Joliet', state: 'IL', credit: 657, trucks: 31, cards: 28, date: 'May 22, 2025', agent: 'Marcus Cole', notes: 'Active LOC — watch payment cadence.', cycle: '1 Billing Cycle', pay: 'LOC', ta: 1, efs: 1, lmt: 1, mob: 1, chn: 1, verified: true, carrierId: '291006' },
  { id: 'c5', appId: 'APP-20377', company: 'Coastal Dispatch Inc', first: 'Mia', last: 'Reyes', biz: 'Corporation', stage: 'Closed Won', wex: 'Cards Produced', mc: 'MC-712004', dot: '3120099', phone: '9045550158', email: 'billing@coastaldispatch.com', city: 'Jacksonville', state: 'FL', credit: 721, trucks: 12, cards: 10, date: 'Jun 16, 2025', agent: 'Wei Zhang', notes: 'Closed won — onboarding complete.', cycle: '2 Billing Cycle', pay: 'Deposit', ta: 1, efs: 1, lmt: 1, mob: 1, chn: 1, verified: true, carrierId: '388491' },
];

export type CitiStatus = 'In process' | 'Cards sent' | 'Closed';
export type CitiRequest = 'Incoming' | 'Outbound';
export type CitiDecision = '' | 'Octane card' | 'Citi card' | 'Debtor';

export interface CitiClient {
  id: string;
  name: string;
  appId: string;
  status: CitiStatus;
  request: CitiRequest;
  decision: CitiDecision;
  date: string;
  phone: string;
  email: string;
  agent: string;
  notes: string;
}

export const CITI_CLIENTS: CitiClient[] = [
  { id: 'f1', name: 'Ridgeline Freight LLC', appId: '20482', status: 'In process', request: 'Incoming', decision: '', date: 'Jun 26, 2025', phone: '4155550142', email: 'ops@ridgelinefrt.com', agent: 'Priya Nair', notes: 'Requested CITI to re-check pending card batch.' },
  { id: 'f2', name: 'Ironhide Logistics LLC', appId: '20330', status: 'Cards sent', request: 'Outbound', decision: 'Citi card', date: 'Jun 06, 2025', phone: '4155550190', email: 'ops@ironhidelog.com', agent: 'Marcus Cole', notes: 'Cards shipped via CITI; tracking confirmed.' },
  { id: 'f3', name: 'Blue Mesa Trucking', appId: '20521', status: 'In process', request: 'Incoming', decision: '', date: 'Jun 28, 2025', phone: '4805550151', email: 'rachel@bluemesa.com', agent: 'Priya Nair', notes: 'New inbound request; awaiting app completion.' },
  { id: 'f4', name: 'Vanguard Carriers LLC', appId: '20301', status: 'Closed', request: 'Outbound', decision: 'Octane card', date: 'May 24, 2025', phone: '3125550143', email: 'ops@vanguardcarr.com', agent: 'Wei Zhang', notes: 'Moved to Octane card program — CITI declined.' },
  { id: 'f5', name: 'Sierra Haul Co', appId: '20455', status: 'Cards sent', request: 'Outbound', decision: 'Citi card', date: 'Jun 21, 2025', phone: '3235550119', email: 'tom@sierrahaul.com', agent: 'Wei Zhang', notes: 'CITI cards produced and dispatched.' },
  { id: 'f6', name: 'Harbor Point Logistics', appId: '20510', status: 'In process', request: 'Incoming', decision: '', date: 'Jun 27, 2025', phone: '7025550176', email: 'dispatch@harborpt.com', agent: 'Marcus Cole', notes: 'Agent call scheduled to verify fleet size.' },
  { id: 'f7', name: 'Granite State Transport', appId: '20498', status: 'Closed', request: 'Outbound', decision: 'Debtor', date: 'Jun 25, 2025', phone: '6035550133', email: 'billing@granitest.com', agent: 'Marcus Cole', notes: 'Flagged as debtor — CITI enrollment paused.' },
  { id: 'f8', name: 'Redwood Freightways', appId: '20441', status: 'In process', request: 'Incoming', decision: '', date: 'Jun 20, 2025', phone: '5035550164', email: 'accounts@redwoodfw.com', agent: 'Priya Nair', notes: 'Deposit counter-offer under review.' },
  { id: 'f9', name: 'Cedar Ridge Transport', appId: '20288', status: 'Cards sent', request: 'Outbound', decision: 'Citi card', date: 'May 30, 2025', phone: '6155550172', email: 'ap@cedarridge.com', agent: 'Wei Zhang', notes: 'CITI cards active on prepay balance.' },
  { id: 'f10', name: 'Coastal Dispatch Inc', appId: '20377', status: 'Closed', request: 'Outbound', decision: 'Octane card', date: 'Jun 17, 2025', phone: '9045550158', email: 'billing@coastaldispatch.com', agent: 'Wei Zhang', notes: 'Onboarded on Octane; CITI request closed.' },
];

// ---- Analytics seed ----

export interface KpiStat {
  label: string;
  value: string;
  hint?: string;
  delta?: { prev: number; current: number; higherIsBetter: boolean };
}

export interface VolumeDay {
  label: string;
  value: number;
  partial?: boolean;
}

export interface BreakdownItem {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'purple' | 'sky' | 'teal' | 'amber';
}

export interface LeaderboardRow {
  agent: string;
  col1: number;
  col2: number | string;
  col3: number;
}

export interface AnalyticsBlock {
  kpis: KpiStat[];
  volume: VolumeDay[];
  breakdown: BreakdownItem[];
  leaderboardCols: [string, string, string];
  leaderboard: LeaderboardRow[];
}

const VOLUME_14D_TICKETS: VolumeDay[] = [
  { label: 'Jun 19', value: 21 }, { label: 'Jun 20', value: 26 }, { label: 'Jun 21', value: 14 },
  { label: 'Jun 22', value: 9 }, { label: 'Jun 23', value: 24 }, { label: 'Jun 24', value: 29 },
  { label: 'Jun 25', value: 31 }, { label: 'Jun 26', value: 27 }, { label: 'Jun 27', value: 22 },
  { label: 'Jun 28', value: 17 }, { label: 'Jun 29', value: 13 }, { label: 'Jun 30', value: 25 },
  { label: 'Jul 01', value: 28 }, { label: 'Jul 02', value: 16, partial: true },
];

const VOLUME_14D_CALLS: VolumeDay[] = [
  { label: 'Jun 19', value: 17 }, { label: 'Jun 20', value: 22 }, { label: 'Jun 21', value: 11 },
  { label: 'Jun 22', value: 6 }, { label: 'Jun 23', value: 19 }, { label: 'Jun 24', value: 23 },
  { label: 'Jun 25', value: 25 }, { label: 'Jun 26', value: 21 }, { label: 'Jun 27', value: 18 },
  { label: 'Jun 28', value: 14 }, { label: 'Jun 29', value: 10 }, { label: 'Jun 30', value: 20 },
  { label: 'Jul 01', value: 22 }, { label: 'Jul 02', value: 12, partial: true },
];

const VOLUME_14D_MAINT: VolumeDay[] = [
  { label: 'Jun 19', value: 4 }, { label: 'Jun 20', value: 5 }, { label: 'Jun 21', value: 2 },
  { label: 'Jun 22', value: 1 }, { label: 'Jun 23', value: 3 }, { label: 'Jun 24', value: 5 },
  { label: 'Jun 25', value: 6 }, { label: 'Jun 26', value: 4 }, { label: 'Jun 27', value: 3 },
  { label: 'Jun 28', value: 2 }, { label: 'Jun 29', value: 2 }, { label: 'Jun 30', value: 4 },
  { label: 'Jul 01', value: 3 }, { label: 'Jul 02', value: 2, partial: true },
];

export const ANALYTICS: Record<'tickets' | 'calls' | 'maintenance', AnalyticsBlock> = {
  tickets: {
    kpis: [
      { label: 'Total Tickets', value: '342', hint: 'This range', delta: { prev: 318, current: 342, higherIsBetter: true } },
      { label: 'Open', value: '37', hint: 'Active support cases' },
      { label: 'Resolved', value: '305', hint: 'Closed this range' },
      { label: 'Avg Resolution', value: '6.4h', hint: 'Per ticket', delta: { prev: 7.1, current: 6.4, higherIsBetter: false } },
    ],
    volume: VOLUME_14D_TICKETS,
    breakdown: [
      { label: 'Technical', value: 128, tone: 'sky' },
      { label: 'Billing', value: 74, tone: 'good' },
      { label: 'Account', value: 52, tone: 'purple' },
      { label: 'Fuel Services', value: 41, tone: 'warn' },
      { label: 'General', value: 33, tone: 'amber' },
      { label: 'Escalations', value: 14, tone: 'bad' },
    ],
    leaderboardCols: ['Handled', 'Resolved', 'Avg Hrs'],
    leaderboard: [
      { agent: 'Priya Nair', col1: 96, col2: 91, col3: 5.2 },
      { agent: 'Marcus Cole', col1: 88, col2: 80, col3: 6.1 },
      { agent: 'Wei Zhang', col1: 79, col2: 74, col3: 6.8 },
      { agent: 'Dana Whitfield', col1: 52, col2: 48, col3: 7.4 },
      { agent: 'Leah Byrne', col1: 27, col2: 22, col3: 8.9 },
    ],
  },
  calls: {
    kpis: [
      { label: 'Total Calls', value: '268', hint: 'This range', delta: { prev: 240, current: 268, higherIsBetter: true } },
      { label: 'Inbound', value: '210', hint: 'Received calls' },
      { label: 'Missed', value: '18', hint: 'Unanswered' },
      { label: 'Avg Duration', value: '4m 12s', hint: 'Per call' },
    ],
    volume: VOLUME_14D_CALLS,
    breakdown: [
      { label: 'Inbound', value: 210, tone: 'info' },
      { label: 'Outbound', value: 40, tone: 'teal' },
      { label: 'Missed', value: 18, tone: 'bad' },
    ],
    leaderboardCols: ['Calls', 'Avg Dur', 'CSAT%'],
    leaderboard: [
      { agent: 'Marcus Cole', col1: 84, col2: '4m 02s', col3: 96 },
      { agent: 'Priya Nair', col1: 77, col2: '3m 48s', col3: 94 },
      { agent: 'Wei Zhang', col1: 61, col2: '4m 31s', col3: 90 },
      { agent: 'Leah Byrne', col1: 29, col2: '5m 12s', col3: 86 },
      { agent: 'Dana Whitfield', col1: 17, col2: '4m 20s', col3: 92 },
    ],
  },
  maintenance: {
    kpis: [
      { label: 'Total Cases', value: '46', hint: 'This range', delta: { prev: 52, current: 46, higherIsBetter: false } },
      { label: 'Open', value: '6', hint: 'Open this month' },
      { label: 'Resolved', value: '40', hint: 'Closed this range' },
      { label: 'Avg Resolution', value: '19.2h', hint: 'Per case', delta: { prev: 22.5, current: 19.2, higherIsBetter: false } },
    ],
    volume: VOLUME_14D_MAINT,
    breakdown: [
      { label: 'Card Replacement', value: 18, tone: 'warn' },
      { label: 'Limit Change', value: 12, tone: 'sky' },
      { label: 'Account Update', value: 9, tone: 'purple' },
      { label: 'Other', value: 7, tone: 'neutral' },
    ],
    leaderboardCols: ['Handled', 'Resolved', 'Avg Hrs'],
    leaderboard: [
      { agent: 'Wei Zhang', col1: 16, col2: 14, col3: 17.1 },
      { agent: 'Priya Nair', col1: 12, col2: 11, col3: 18.4 },
      { agent: 'Marcus Cole', col1: 11, col2: 9, col3: 20.2 },
      { agent: 'Leah Byrne', col1: 7, col2: 6, col3: 22.0 },
    ],
  },
};

// ---- Home screen seed ----

export interface ActivityRow {
  id: string;
  text: string;
  sub: string;
  time: string;
  dot: 'purple' | 'sky' | 'good' | 'bad' | 'orange';
}

export const RECENT_ACTIVITY: ActivityRow[] = [
  { id: 'act1', text: 'Ridgeline Freight LLC → moved to Adjudication', sub: 'Application APP-20482', time: '8m ago', dot: 'purple' },
  { id: 'act2', text: 'Ironhide Logistics → CITI cards shipped', sub: 'CITI Fuel · Citi card', time: '32m ago', dot: 'sky' },
  { id: 'act3', text: 'Ticket #4471 resolved by Priya Nair', sub: 'Technical Support', time: '1h ago', dot: 'good' },
  { id: 'act4', text: 'Granite State Transport flagged as debtor', sub: 'CITI Fuel · enrollment paused', time: '2h ago', dot: 'bad' },
  { id: 'act5', text: 'Sierra Haul Co → entered EFS Processing', sub: 'Application APP-20455', time: '3h ago', dot: 'orange' },
  { id: 'act6', text: 'Coastal Dispatch Inc → Closed Won', sub: 'Onboarding complete', time: '5h ago', dot: 'good' },
];

export interface PriorityRow {
  label: string;
  count: number;
  tone: 'bad' | 'warn' | 'info' | 'neutral';
}

export const OPEN_TICKETS_BY_PRIORITY: PriorityRow[] = [
  { label: 'Urgent', count: 5, tone: 'bad' },
  { label: 'High', count: 12, tone: 'warn' },
  { label: 'Medium', count: 15, tone: 'info' },
  { label: 'Low', count: 5, tone: 'neutral' },
];

export const TEAM_OVERVIEW = {
  openTickets: 37,
  pendingApps: 18,
  activeClients: 214,
  maintenance: 6,
};

export const MY_PERFORMANCE = {
  myPendingApps: 7,
  myActiveClients: 52,
  myTicketsMonth: 23,
  myTicketsLastMonth: 19,
};

// ---- formatting / meta helpers ----
// Tones are restricted to StatusTone ('good'|'warn'|'bad'|'info'|'neutral') so
// every badge-facing helper below can feed StatusBadge directly.

export function stageMeta(stage: string): { tone: 'good' | 'bad' | 'info' | 'neutral' | 'warn' } {
  const map: Record<string, 'good' | 'bad' | 'info' | 'neutral' | 'warn'> = {
    'Application': 'info',
    'Application Sent': 'info',
    'Application Filled': 'info',
    'Adjudication': 'warn',
    'Credit Follow-up': 'bad',
    'CS Validation': 'warn',
    'Vendor Validation': 'warn',
    'EFS Processing': 'warn',
    'Implementation': 'info',
    'Expansion': 'good',
    'Cards Sent': 'info',
    'Cards Activated': 'info',
    'Card Funded': 'good',
    'Card Swiped': 'info',
    'Billing Form Sent': 'info',
    'Billing Form Filled': 'good',
    'Closed Won': 'good',
    'Closed Lost': 'bad',
  };
  return { tone: map[stage] ?? 'neutral' };
}

export function bizMeta(biz: Business): { tone: 'good' | 'bad' | 'info' | 'neutral' | 'warn' } {
  const map: Record<Business, 'good' | 'bad' | 'info' | 'neutral' | 'warn'> = {
    LLC: 'info',
    Corporation: 'neutral',
    'Sole Proprietorship': 'neutral',
    Partnership: 'warn',
  };
  return { tone: map[biz] };
}

export function creditTone(credit: number | null): 'good' | 'warn' | 'bad' | 'neutral' {
  if (credit == null) return 'neutral';
  if (credit >= 700) return 'good';
  if (credit >= 660) return 'warn';
  return 'bad';
}

export function citiStatusMeta(status: CitiStatus): { tone: 'good' | 'warn' | 'info' | 'neutral' } {
  if (status === 'Cards sent') return { tone: 'info' };
  if (status === 'Closed') return { tone: 'neutral' };
  return { tone: 'warn' };
}

export function citiRequestMeta(request: CitiRequest): { tone: 'good' | 'warn' | 'info' | 'neutral' } {
  return request === 'Outbound' ? { tone: 'warn' } : { tone: 'info' };
}

export function citiDecisionMeta(decision: CitiDecision): { tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' } {
  if (decision === 'Octane card') return { tone: 'good' };
  if (decision === 'Citi card') return { tone: 'info' };
  if (decision === 'Debtor') return { tone: 'bad' };
  return { tone: 'neutral' };
}

export function onboardingCount(app: Application): number {
  return app.ta + app.efs + app.lmt + app.mob + app.chn;
}

export function isClient(app: Application): boolean {
  return app.carrierId !== '';
}

export function fullName(app: Application): string {
  return `${app.first} ${app.last}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
