// Seed data + formatting/color helpers for the Retention Mytrion, ported from
// the Retention Mytrion mockup's condensed spec (cases kanban + open pool +
// inbox). Static fixtures — real Zoho/servercrm wiring comes later.

export type Risk = 'high' | 'medium' | 'low';
export type Stage = 'new' | 'contacted' | 'negotiating' | 'offer' | 'saved' | 'lost';

export interface RetentionCase {
  id: string;
  company: string;
  carrierId: string;
  risk: Risk;
  reason: string;
  mrr: number;
  competitor: string;
  owner: string;
  days: number;
  lastTx: string;
  stage: Stage;
}

export type PoolAssignment = 'Available' | 'Requested' | 'Assigned' | 'Rejected';

export interface PoolRow {
  id: string;
  carrierId: string;
  company: string;
  fullName: string;
  assign: PoolAssignment;
  lastTx: string;
  reason: string;
  cards: number;
  status: 'Active' | 'Suspended';
  takenBy: string;
}

export type NotificationType =
  | 'risk'
  | 'accepted'
  | 'competitor'
  | 'assigned'
  | 'declined'
  | 'churned'
  | 'resumed'
  | 'reminder';

export interface RetentionNotification {
  id: string;
  type: NotificationType;
  title: string;
  detail: string;
  time: string;
  group: 'today' | 'earlier';
  read: boolean;
}

export const CASES: RetentionCase[] = [
  { id: 'r1', company: 'Ironhide Logistics LLC', carrierId: '104882', risk: 'high', reason: 'Volume down 68% over 30 days; two support escalations.', mrr: 4200, competitor: '', owner: 'Priya Nair', days: 12, lastTx: 'Jun 02', stage: 'new' },
  { id: 'r2', company: 'Cedar Ridge Transport', carrierId: '205513', risk: 'medium', reason: 'Dormant 24 days after a billing dispute.', mrr: 2650, competitor: '', owner: 'Marcus Cole', days: 6, lastTx: 'Jun 06', stage: 'new' },
  { id: 'r3', company: 'Blue Vector Freight', carrierId: '118734', risk: 'high', reason: 'Requested competitor quote; card usage stalled.', mrr: 5100, competitor: 'Fuelman', owner: 'Priya Nair', days: 9, lastTx: 'May 29', stage: 'contacted' },
  { id: 'r4', company: 'Summit Line Haul', carrierId: '330219', risk: 'low', reason: 'Slight dip in weekly swipes; monitoring.', mrr: 1800, competitor: '', owner: 'Wei Zhang', days: 4, lastTx: 'Jun 20', stage: 'contacted' },
  { id: 'r5', company: 'Vanguard Carriers LLC', carrierId: '291006', risk: 'high', reason: 'Threatened to leave over pricing; 31 cards idle.', mrr: 7300, competitor: 'RTS', owner: 'Marcus Cole', days: 15, lastTx: 'May 22', stage: 'negotiating' },
  { id: 'r6', company: 'Granite Peak Freight', carrierId: '502244', risk: 'medium', reason: 'Wants better LOC terms; open to staying.', mrr: 3400, competitor: '', owner: 'Wei Zhang', days: 8, lastTx: 'Jun 12', stage: 'negotiating' },
  { id: 'r7', company: 'Coastal Dispatch Inc', carrierId: '388491', risk: 'medium', reason: 'Reviewing a 3% fuel-back offer.', mrr: 2900, competitor: 'TCS', owner: 'Priya Nair', days: 5, lastTx: 'Jun 16', stage: 'offer' },
  { id: 'r8', company: 'Iron Oak Transport', carrierId: '271883', risk: 'high', reason: 'Offer sent: waived fees + rate lock for 6 mo.', mrr: 6100, competitor: '', owner: 'Marcus Cole', days: 3, lastTx: 'Jun 18', stage: 'offer' },
  { id: 'r9', company: 'Silverline Freightways', carrierId: '619047', risk: 'low', reason: 'Accepted retention offer; volume recovering.', mrr: 3950, competitor: '', owner: 'Wei Zhang', days: 2, lastTx: 'Jun 26', stage: 'saved' },
  { id: 'r10', company: 'Apex Mile Carriers', carrierId: '133705', risk: 'medium', reason: 'Re-engaged after call; resumed daily swipes.', mrr: 2400, competitor: '', owner: 'Priya Nair', days: 1, lastTx: 'Jun 28', stage: 'saved' },
  { id: 'r11', company: 'Northwind Haulers', carrierId: '577310', risk: 'high', reason: 'Moved fleet to competitor; closed lost.', mrr: 5600, competitor: 'BVD', owner: 'Marcus Cole', days: 20, lastTx: 'May 12', stage: 'lost' },
];

export const POOL: PoolRow[] = [
  { id: 'p1', carrierId: '448210', company: 'Redwood Haulage Co', fullName: 'Owen Pratt', assign: 'Available', lastTx: 'May 18, 2025', reason: 'Dormant 40+ days', cards: 18, status: 'Active', takenBy: '' },
  { id: 'p2', carrierId: '390771', company: 'Nightfall Trucking', fullName: 'Lily Munoz', assign: 'Available', lastTx: 'May 30, 2025', reason: 'Volume down 55%', cards: 9, status: 'Active', takenBy: '' },
  { id: 'p3', carrierId: '501224', company: 'Halcyon Freight Systems', fullName: 'Grace Yoon', assign: 'Requested', lastTx: 'Jun 02, 2025', reason: 'Competitor quote requested', cards: 22, status: 'Active', takenBy: 'You' },
  { id: 'p4', carrierId: '420669', company: 'Copperline Transport', fullName: 'Ben Frost', assign: 'Available', lastTx: 'May 25, 2025', reason: 'No swipes 3 weeks', cards: 14, status: 'Active', takenBy: '' },
  { id: 'p5', carrierId: '712004', company: 'Boxcar Freight Co', fullName: 'Mia Reyes', assign: 'Assigned', lastTx: 'Jun 08, 2025', reason: 'Billing complaint', cards: 7, status: 'Active', takenBy: 'P. Nair' },
  { id: 'p6', carrierId: '559013', company: 'Meridian Haul Group', fullName: 'Sam Ortiz', assign: 'Available', lastTx: 'May 14, 2025', reason: 'Dormant 45+ days', cards: 31, status: 'Active', takenBy: '' },
  { id: 'p7', carrierId: '931200', company: 'Blue Mesa Trucking', fullName: 'Rachel Long', assign: 'Rejected', lastTx: 'Jun 10, 2025', reason: 'Pricing objection', cards: 5, status: 'Suspended', takenBy: 'M. Cole' },
  { id: 'p8', carrierId: '660928', company: 'Sierra Haul Co', fullName: 'Tom Alvarez', assign: 'Available', lastTx: 'Jun 01, 2025', reason: 'Declining volume', cards: 6, status: 'Active', takenBy: '' },
  { id: 'p9', carrierId: '814772', company: 'Granite State Transport', fullName: 'Nadia Khan', assign: 'Requested', lastTx: 'Jun 05, 2025', reason: 'Card usage stalled', cards: 11, status: 'Active', takenBy: 'You' },
];

export const NOTIFICATIONS: RetentionNotification[] = [
  { id: 'n1', type: 'risk', title: 'New at-risk client flagged', detail: 'Ironhide Logistics LLC — volume down 68% over 30 days', time: '14m ago', group: 'today', read: false },
  { id: 'n2', type: 'accepted', title: 'Retention offer accepted', detail: 'Silverline Freightways accepted the fee waiver + rate lock', time: '1h ago', group: 'today', read: false },
  { id: 'n3', type: 'competitor', title: 'Competitor detected', detail: 'Vanguard Carriers requested an RTS quote', time: '2h ago', group: 'today', read: false },
  { id: 'n4', type: 'assigned', title: 'Case assigned to you', detail: 'Blue Vector Freight moved into your queue', time: '3h ago', group: 'today', read: false },
  { id: 'n5', type: 'declined', title: 'Retention offer declined', detail: 'Northwind Haulers declined — considering BVD', time: 'Yesterday', group: 'earlier', read: true },
  { id: 'n6', type: 'churned', title: 'Client churned', detail: 'Northwind Haulers moved their fleet to a competitor', time: 'Yesterday', group: 'earlier', read: true },
  { id: 'n7', type: 'resumed', title: 'Payment resumed', detail: 'Apex Mile Carriers resumed daily card swipes', time: '2d ago', group: 'earlier', read: true },
  { id: 'n8', type: 'reminder', title: 'Follow-up due', detail: 'Coastal Dispatch — offer expires in 2 days', time: '2d ago', group: 'earlier', read: true },
];

// ---- stage meta (kanban columns) ----

export const STAGE_ORDER: Stage[] = ['new', 'contacted', 'negotiating', 'offer', 'saved'];

export interface StageMeta {
  label: string;
  colorVar: string;
}

export const STAGE_META: Record<Stage, StageMeta> = {
  new: { label: 'At Risk', colorVar: 'var(--accent)' },
  contacted: { label: 'Contacted', colorVar: 'var(--info, var(--accent))' },
  negotiating: { label: 'Negotiating', colorVar: 'var(--warning)' },
  offer: { label: 'Offer Sent', colorVar: 'var(--purple)' },
  saved: { label: 'Saved', colorVar: 'var(--success)' },
  lost: { label: 'Churned', colorVar: 'var(--danger)' },
};

export const KANBAN_COLUMNS: Stage[] = ['new', 'contacted', 'negotiating', 'offer', 'saved', 'lost'];

// ---- formatting / color helpers ----

export function fmtMrr(n: number): string {
  return '$' + n.toLocaleString('en-US') + '/mo';
}

export function mrrTone(n: number): 'bad' | 'warn' | 'neutral' {
  if (n >= 5000) return 'bad';
  if (n >= 3000) return 'warn';
  return 'neutral';
}

export function daysTone(days: number): 'bad' | 'warn' | 'neutral' {
  if (days >= 14) return 'bad';
  if (days >= 7) return 'warn';
  return 'neutral';
}

export function riskTone(risk: Risk): 'bad' | 'warn' | 'info' {
  if (risk === 'high') return 'bad';
  if (risk === 'medium') return 'warn';
  return 'info';
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function casesByStage(cases: RetentionCase[], stage: Stage): RetentionCase[] {
  return cases.filter((c) => c.stage === stage);
}

export function nextStage(stage: Stage): Stage {
  if (stage === 'lost') return 'new';
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return 'saved';
  const next = STAGE_ORDER[idx + 1];
  return next ?? 'saved';
}

export function advanceLabel(stage: Stage): string {
  if (stage === 'lost') return 'Reopen';
  if (stage === 'saved') return 'Retained';
  if (stage === 'offer') return 'Mark Saved';
  return 'Advance';
}

// ---- pool helpers ----

export const POOL_ASSIGN_TONE: Record<PoolAssignment, 'good' | 'info' | 'warn' | 'bad'> = {
  Available: 'good',
  Requested: 'info',
  Assigned: 'warn',
  Rejected: 'bad',
};

export function poolCountByAssign(rows: PoolRow[], assign: PoolAssignment): number {
  return rows.filter((r) => r.assign === assign).length;
}

// ---- inbox helpers ----

export const ALERT_TYPES: NotificationType[] = ['risk', 'competitor', 'churned', 'declined'];

export function unreadCount(notifications: RetentionNotification[]): number {
  return notifications.filter((n) => !n.read).length;
}
