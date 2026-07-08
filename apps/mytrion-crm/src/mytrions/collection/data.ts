// Seed data + formatting/color helpers for the Collection Mytrion, ported from
// the Collection Mytrion mockup's DCLogic class (_seedCases/_array/_inbox +
// _stageTitle/_priorityMeta). Static fixtures — real Zoho/servercrm wiring
// comes later, mirroring Billing's data.ts approach.

export type CaseStage = 'handoff' | 'contacting' | 'array' | 'plan' | 'recovered' | 'baddebt';
export type Priority = 'high' | 'medium' | 'low';

export interface CollectionCase {
  id: string;
  stage: CaseStage;
  company: string;
  carrierId: string;
  priority: Priority;
  outstanding: number;
  invoices: number;
  oldestDays: number;
  deactivated: string;
  billingOwner: string;
  owner: string;
  lastContact: string;
  reason: string;
  // stage-specific extras
  arrayRef?: string;
  submitted?: string;
  planPct?: number;
  planNext?: string;
  planAmt?: number;
  recoveredAmt?: number;
  resolved?: string;
  writeoffDate?: string;
  attempts?: number;
}

export const CASES: CollectionCase[] = [
  { id: 'c1', stage: 'handoff', company: 'Ironhorse Freight LLC', carrierId: '402118', priority: 'high', outstanding: 9240, invoices: 4, oldestDays: 148, deactivated: 'May 14', billingOwner: 'Sofia Nguyen', owner: 'Marcus Reyes', lastContact: '—', reason: '3 missed invoices post-deactivation' },
  { id: 'c2', stage: 'handoff', company: 'Delgado Transport', carrierId: '338207', priority: 'medium', outstanding: 3850, invoices: 2, oldestDays: 96, deactivated: 'Jun 02', billingOwner: 'Owen Pratt', owner: 'Marcus Reyes', lastContact: '—', reason: 'Card deactivated, invoice unpaid 30d+' },
  { id: 'c3', stage: 'handoff', company: 'Vela Owner-Op', carrierId: '551340', priority: 'low', outstanding: 1420, invoices: 1, oldestDays: 72, deactivated: 'Jun 18', billingOwner: 'Lily Munoz', owner: 'Dana Cole', lastContact: '—', reason: 'Single unpaid invoice, small balance' },
  { id: 'c4', stage: 'contacting', company: 'Ridge Line Carriers', carrierId: '210984', priority: 'high', outstanding: 12600, invoices: 6, oldestDays: 172, deactivated: 'Apr 28', billingOwner: 'Sofia Nguyen', owner: 'Marcus Reyes', lastContact: '2d ago', attempts: 5, reason: 'Non-responsive to billing follow-up' },
  { id: 'c5', stage: 'contacting', company: 'Basin Haul Co', carrierId: '447203', priority: 'medium', outstanding: 5120, invoices: 3, oldestDays: 110, deactivated: 'May 25', billingOwner: 'Owen Pratt', owner: 'Dana Cole', lastContact: '4d ago', attempts: 3, reason: 'Promised payment, not received' },
  { id: 'c6', stage: 'contacting', company: 'Novak Logistics', carrierId: '662551', priority: 'medium', outstanding: 6700, invoices: 4, oldestDays: 121, deactivated: 'May 20', billingOwner: 'Ava Sinclair', owner: 'Marcus Reyes', lastContact: '1d ago', attempts: 2, reason: 'Disputing 2 invoice amounts' },
  { id: 'c7', stage: 'array', company: 'Cascade Freight Group', carrierId: '118773', priority: 'high', outstanding: 18900, invoices: 8, oldestDays: 205, deactivated: 'Mar 22', billingOwner: 'Sofia Nguyen', owner: 'Dana Cole', lastContact: '8d ago', arrayRef: 'AR-20514', submitted: 'Jun 20', reason: 'Escalated after final follow-up failed' },
  { id: 'c8', stage: 'array', company: 'Pioneer Trucking', carrierId: '305612', priority: 'medium', outstanding: 7400, invoices: 5, oldestDays: 158, deactivated: 'Apr 30', billingOwner: 'Priya Rao', owner: 'Marcus Reyes', lastContact: '12d ago', arrayRef: 'AR-20488', submitted: 'Jun 12', reason: 'Unreachable — filed to agency' },
  { id: 'c9', stage: 'plan', company: 'Summit Line Haul', carrierId: '229140', priority: 'medium', outstanding: 4300, invoices: 5, oldestDays: 134, deactivated: 'May 08', billingOwner: 'Owen Pratt', owner: 'Dana Cole', lastContact: '3d ago', planPct: 55, planNext: 'Jul 08', planAmt: 600, reason: 'Negotiated weekly payment plan' },
  { id: 'c10', stage: 'plan', company: 'Harbor Point Cargo', carrierId: '480221', priority: 'low', outstanding: 2150, invoices: 3, oldestDays: 88, deactivated: 'Jun 05', billingOwner: 'Lily Munoz', owner: 'Marcus Reyes', lastContact: '6d ago', planPct: 70, planNext: 'Jul 05', planAmt: 350, reason: 'On track with installment plan' },
  { id: 'c11', stage: 'recovered', company: 'Redwood Haulage', carrierId: '175640', priority: 'low', outstanding: 0, recoveredAmt: 6800, invoices: 4, oldestDays: 0, deactivated: 'Apr 12', billingOwner: 'Ava Sinclair', owner: 'Marcus Reyes', lastContact: '—', resolved: 'Jun 28', reason: 'Paid in full after payment plan' },
  { id: 'c12', stage: 'recovered', company: 'Crestway Transport', carrierId: '390118', priority: 'medium', outstanding: 0, recoveredAmt: 3400, invoices: 2, oldestDays: 0, deactivated: 'May 02', billingOwner: 'Priya Rao', owner: 'Dana Cole', lastContact: '—', resolved: 'Jun 25', reason: 'Recovered via Array — collected in full' },
  { id: 'c13', stage: 'baddebt', company: 'Falcon Ridge Freight', carrierId: '662004', priority: 'high', outstanding: 15300, invoices: 7, oldestDays: 262, deactivated: 'Feb 10', billingOwner: 'Sofia Nguyen', owner: 'Dana Cole', lastContact: '—', writeoffDate: 'Jun 15', reason: 'Uncollectible after full timeline' },
];

export type ArrayStatus = 'Pending Submission' | 'In Array' | 'Returned' | 'Recovered';

export interface ArrayUpdate {
  date: string;
  note: string;
}

export interface ArrayRow {
  id: string;
  carrierId: string;
  company: string;
  debtor: string;
  owed: number;
  invoices: number;
  oldestInv: string;
  daysOverdue: number;
  lastUpdate: string;
  status: ArrayStatus;
  collector: string;
  notes: string;
  updates: ArrayUpdate[];
}

export const ARRAY_ROWS: ArrayRow[] = [
  { id: 'r1', carrierId: '118773', company: 'Cascade Freight Group', debtor: 'Martin Cascade', owed: 18900, invoices: 8, oldestInv: 'Dec 08', daysOverdue: 205, lastUpdate: 'Today 08:12', status: 'In Array', collector: 'Dana Cole', notes: 'Agency actively pursuing. Skip-trace complete.', updates: [{ date: 'Jun 20', note: 'Submitted to Array with full invoice packet.' }, { date: 'Jun 27', note: 'Array confirmed debtor contact; payment demand issued.' }] },
  { id: 'r2', carrierId: '305612', company: 'Pioneer Trucking', debtor: 'Rafael Pioneer', owed: 7400, invoices: 5, oldestInv: 'Jan 24', daysOverdue: 158, lastUpdate: 'Today 08:40', status: 'In Array', collector: 'Marcus Reyes', notes: 'Partial-payment negotiation in progress via agency.', updates: [{ date: 'Jun 12', note: 'Filed to Array (AR-20488).' }, { date: 'Jun 24', note: 'Debtor proposed 50% settlement — under review.' }] },
  { id: 'r3', carrierId: '210984', company: 'Ridge Line Carriers', debtor: 'Samuel Ridge', owed: 12600, invoices: 6, oldestInv: 'Jan 10', daysOverdue: 172, lastUpdate: 'Today 09:02', status: 'Pending Submission', collector: 'Marcus Reyes', notes: 'Final follow-up window closes today; queue for Array.', updates: [{ date: 'Jun 28', note: '5th call attempt — no response.' }, { date: 'Today', note: 'Flagged for Array submission in tomorrow batch.' }] },
  { id: 'r4', carrierId: '662004', company: 'Falcon Ridge Freight', debtor: 'Tomas Falcon', owed: 15300, invoices: 7, oldestInv: 'Oct 12', daysOverdue: 262, lastUpdate: 'Jun 15', status: 'Returned', collector: 'Dana Cole', notes: 'Array returned uncollectible — moved to bad-debt write-off.', updates: [{ date: 'May 20', note: 'Submitted to Array.' }, { date: 'Jun 15', note: 'Returned: debtor insolvent — recommend write-off.' }] },
  { id: 'r5', carrierId: '447203', company: 'Basin Haul Co', debtor: 'Nadia Basin', owed: 5120, invoices: 3, oldestInv: 'Mar 12', daysOverdue: 110, lastUpdate: 'Today 09:20', status: 'Pending Submission', collector: 'Dana Cole', notes: 'Awaiting final follow-up outcome before filing.', updates: [{ date: 'Jun 26', note: 'Promised payment not received.' }, { date: 'Today', note: 'Balance summary refreshed.' }] },
  { id: 'r6', carrierId: '390118', company: 'Crestway Transport', debtor: 'Owen Crest', owed: 3400, invoices: 2, oldestInv: 'Apr 02', daysOverdue: 0, lastUpdate: 'Jun 25', status: 'Recovered', collector: 'Dana Cole', notes: 'Collected in full by Array. Case closed.', updates: [{ date: 'Jun 05', note: 'Submitted to Array.' }, { date: 'Jun 25', note: 'Recovered in full — remitted to Octane.' }] },
  { id: 'r7', carrierId: '662551', company: 'Novak Logistics', debtor: 'Petra Novak', owed: 6700, invoices: 4, oldestInv: 'Mar 01', daysOverdue: 121, lastUpdate: 'Yesterday', status: 'Pending Submission', collector: 'Marcus Reyes', notes: 'Dispute on 2 invoices being resolved before filing.', updates: [{ date: 'Jun 24', note: 'Client disputes 2 line items.' }, { date: 'Yesterday', note: 'Dispute review with Billing scheduled.' }] },
  { id: 'r8', carrierId: '338207', company: 'Delgado Transport', debtor: 'Luis Delgado', owed: 3850, invoices: 2, oldestInv: 'Apr 06', daysOverdue: 96, lastUpdate: 'Today 07:55', status: 'Pending Submission', collector: 'Marcus Reyes', notes: 'New handoff; first contact attempt logged.', updates: [{ date: 'Today', note: 'Handed off from Billing; added to daily roster.' }] },
  { id: 'r9', carrierId: '175640', company: 'Redwood Haulage', debtor: 'Kara Redwood', owed: 6800, invoices: 4, oldestInv: 'Feb 18', daysOverdue: 0, lastUpdate: 'Jun 28', status: 'Recovered', collector: 'Marcus Reyes', notes: 'Recovered via internal payment plan before escalation.', updates: [{ date: 'Jun 10', note: 'Payment plan agreed.' }, { date: 'Jun 28', note: 'Final installment cleared — recovered.' }] },
];

export type InboxType = 'handoff' | 'paid' | 'array-full' | 'clock' | 'plan-missed' | 'array-none' | 'writeoff' | 'promise';
export type InboxGroup = 'today' | 'earlier';

export interface InboxNotification {
  id: string;
  type: InboxType;
  title: string;
  detail: string;
  time: string;
  group: InboxGroup;
  read: boolean;
}

export const INBOX: InboxNotification[] = [
  { id: 'n1', type: 'handoff', title: 'New debtor handed off', detail: 'Ironhorse Freight LLC — $9,240 unpaid · deactivated May 14 (from Billing)', time: '12m ago', group: 'today', read: false },
  { id: 'n2', type: 'paid', title: 'Installment payment received', detail: 'Harbor Point Cargo paid $350 — payment plan on track', time: '40m ago', group: 'today', read: false },
  { id: 'n3', type: 'array-full', title: 'Array recovered in full', detail: 'Crestway Transport — $3,400 collected & remitted to Octane', time: '1h ago', group: 'today', read: false },
  { id: 'n4', type: 'clock', title: 'Escalation clock advanced', detail: 'Cascade Freight Group entered the Insurance stage — 10-day window', time: '2h ago', group: 'today', read: false },
  { id: 'n5', type: 'plan-missed', title: 'Payment plan installment missed', detail: 'Summit Line Haul missed the Jul 08 installment — follow up', time: '3h ago', group: 'today', read: false },
  { id: 'n6', type: 'array-none', title: 'Array returned uncollectible', detail: 'Falcon Ridge Freight — agency recommends bad-debt write-off', time: 'Yesterday', group: 'earlier', read: true },
  { id: 'n7', type: 'writeoff', title: 'Write-off approved', detail: 'Falcon Ridge Freight — $15,300 written off (Management sign-off)', time: 'Yesterday', group: 'earlier', read: true },
  { id: 'n8', type: 'promise', title: 'Promise to pay logged', detail: 'Basin Haul Co committed to clearing the balance by Friday', time: '2d ago', group: 'earlier', read: true },
];

// ---- formatting ----

export function fmtCurrency(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// ---- stage / priority meta ----

export const STAGE_ORDER: CaseStage[] = ['handoff', 'contacting', 'array', 'plan', 'recovered', 'baddebt'];

const STAGE_TITLES: Record<CaseStage, string> = {
  handoff: 'Handed Off',
  contacting: 'Contacting',
  array: 'Filed → Array',
  plan: 'Payment Plan',
  recovered: 'Recovered',
  baddebt: 'Bad Debt',
};

export function stageTitle(stage: CaseStage): string {
  return STAGE_TITLES[stage];
}

export type StageTone = 'bad' | 'warn' | 'purple' | 'good' | 'neutral';

// StatusBadge only ships good/warn/bad/info/neutral tones — 'purple' below is a
// column-accent hint (dot/text color) for the kanban board, not a StatusBadge tone.
const STAGE_TONE: Record<CaseStage, StageTone> = {
  handoff: 'bad',
  contacting: 'warn',
  array: 'purple',
  plan: 'good',
  recovered: 'good',
  baddebt: 'neutral',
};

export function stageTone(stage: CaseStage): StageTone {
  return STAGE_TONE[stage];
}

const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_COLOR: Record<Priority, string> = { high: 'text-bad', medium: 'text-warn', low: 'text-muted-foreground' };
const PRIORITY_DOT: Record<Priority, string> = { high: 'bg-bad', medium: 'bg-warn', low: 'bg-muted-foreground' };

export function priorityLabel(p: Priority): string {
  return PRIORITY_LABEL[p];
}

export function priorityColorClass(p: Priority): string {
  return PRIORITY_COLOR[p];
}

export function priorityDotClass(p: Priority): string {
  return PRIORITY_DOT[p];
}

const ARRAY_STATUS_TONE: Record<ArrayStatus, StageTone> = {
  'Pending Submission': 'warn',
  'In Array': 'purple',
  Returned: 'neutral',
  Recovered: 'good',
};

export function arrayStatusTone(status: ArrayStatus): StageTone {
  return ARRAY_STATUS_TONE[status];
}

// ---- escalation timeline (Bad-Debt Escalation Timeline stepper, §3.10) ----

export interface EscalationNode {
  key: string;
  label: string;
}

export const ESCALATION_NODES: EscalationNode[] = [
  { key: 'tss', label: 'TSS Holds · 20 days' },
  { key: 'collection', label: 'Collection · 30 days' },
  { key: 'insurance', label: 'Insurance · 10 days' },
  { key: 'writeoff', label: 'Write-off · final' },
];

export type NodeState = 'done' | 'current' | 'todo';

/** Maps a case's stage/oldestDays to the escalation stepper's node states. */
export function escalationState(c: CollectionCase): NodeState[] {
  if (c.stage === 'baddebt') return ['done', 'done', 'done', 'done'];
  if (c.stage === 'recovered') return ['done', 'done', 'done', 'todo'];
  // Thresholds roughly follow the §3.10 windows: 20 / 50 / 60 days elapsed.
  const d = c.oldestDays;
  if (d >= 60) return ['done', 'done', 'current', 'todo'];
  if (d >= 20) return ['done', 'current', 'todo', 'todo'];
  return ['current', 'todo', 'todo', 'todo'];
}

// ---- derived helpers used by Cases.tsx / CaseDetail.tsx ----

export interface OutstandingInvoice {
  id: string;
  amount: number;
  overdueDays: number;
}

export function outstandingInvoices(c: CollectionCase): OutstandingInvoice[] {
  const n = c.invoices;
  if (n <= 0) return [];
  const base = Math.floor(c.outstanding / n);
  const remainder = c.outstanding - base * n;
  const last3 = c.carrierId.slice(-3);
  return Array.from({ length: n }, (_, i) => ({
    id: `INV-${last3}${101 + i}`,
    amount: i === n - 1 ? base + remainder : base,
    overdueDays: c.oldestDays,
  }));
}

export type RecoveryChannel = 'RingCentral' | 'Outlook' | 'Note' | 'System';

export interface RecoveryActivity {
  channel: RecoveryChannel;
  text: string;
  time: string;
}

/** Small fixed set of plausible recovery-activity entries per case, keyed off stage/owner. */
export function recoveryActivity(c: CollectionCase): RecoveryActivity[] {
  const entries: RecoveryActivity[] = [
    { channel: 'System', text: `Case handed off from Billing to ${c.owner}`, time: c.deactivated },
  ];
  if (c.stage !== 'handoff') {
    entries.push({ channel: 'RingCentral', text: `Outbound call — ${c.attempts ?? 1} attempt(s) logged`, time: c.lastContact });
    entries.push({ channel: 'Outlook', text: `Follow-up email sent to billing contact`, time: c.lastContact });
  }
  if (c.stage === 'array') {
    entries.push({ channel: 'Note', text: `Filed to Array agency · Ref ${c.arrayRef}`, time: c.submitted ?? '' });
  }
  if (c.stage === 'plan') {
    entries.push({ channel: 'Note', text: `Payment plan agreed — ${c.planPct}% recovered to date`, time: c.lastContact });
  }
  if (c.stage === 'recovered') {
    entries.push({ channel: 'System', text: 'Balance recovered in full', time: c.resolved ?? '' });
  }
  if (c.stage === 'baddebt') {
    entries.push({ channel: 'System', text: 'Written off as uncollectible', time: c.writeoffDate ?? '' });
  }
  return entries.slice(-3);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
