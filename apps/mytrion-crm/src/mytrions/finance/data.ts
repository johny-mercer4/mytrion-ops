// Seed data + formatting/helper functions for the Finance Mytrion, ported from
// the Finance mockup's condensed spec (parent balance, smart-balance events,
// event audits, transaction lines, clients w/ nested invoices/payments/fuel,
// debtors, payments, fueling volume, top locations/carriers, segmentation).
// Static fixtures — real Zoho/servercrm wiring comes later.

// ---- Parent Balance / Smart Balance ----

export interface ParentSnapshot {
  balance: number;
  mode: 'CRITICAL' | 'WARNING' | 'HEALTHY';
  captured: string; // display string, e.g. 'May 11, 2026 03:19 PM'
}

export const PARENT_SNAPSHOT: ParentSnapshot = {
  balance: 63544.85,
  mode: 'CRITICAL',
  captured: 'May 11, 2026 03:19 PM',
};

export type SmartEventStatus = 'IN_DEAD_ZONE' | 'READY';

export interface SmartBalanceEvent {
  recordId: string;
  company: string;
  contractId: string;
  carrierId: string;
  card: string;
  cash: number;
  child: number;
  pre: number;
  net: number;
  gal: number;
  loc: string;
  state: string;
  status: SmartEventStatus;
  dzh: number; // dead-zone hours
  dzu: string; // dead-zone-until iso
  tx: string; // transaction iso
  cap: string; // captured iso
  efs: string;
  mode: 'CRITICAL' | 'WARNING';
  ref: string;
}

export const SMART_BALANCE_EVENTS: SmartBalanceEvent[] = [
  { recordId: '028', company: 'ALI UZ EXPRESS LLC', contractId: '827755', carrierId: '5794572', card: '7083050030582197211', cash: 102.67, child: 102.67, pre: 418.20, net: 696.33, gal: 138.86, loc: 'LOVES #262 TRAVEL STOP', state: 'NM', status: 'IN_DEAD_ZONE', dzh: 16.66, dzu: '2026-05-04T15:10:47', tx: '2026-05-03T22:31:00', cap: '2026-05-11T15:19:00', efs: 'SUCCESS', mode: 'CRITICAL', ref: 'SB-5794572-1526969583' },
  { recordId: '027', company: 'ZHU LLC', contractId: '834915', carrierId: '5799480', card: '7083050030498467559', cash: 175.52, child: 175.52, pre: 520.40, net: 40.02, gal: 115.24, loc: 'MAVERIK LITTLEFIELD #766', state: 'AZ', status: 'IN_DEAD_ZONE', dzh: 13.83, dzu: '2026-05-04T12:08:43', tx: '2026-05-03T22:19:00', cap: '2026-05-11T15:19:00', efs: 'SUCCESS', mode: 'CRITICAL', ref: 'SB-5799480-1526967863' },
  { recordId: '026', company: 'JOURNEY LOGISTICS INC', contractId: '870923', carrierId: '5821353', card: '7083050030499447998', cash: 529.77, child: 529.77, pre: 612.10, net: 269.23, gal: 50.02, loc: 'TA FLORENCE', state: 'KY', status: 'READY', dzh: 6, dzu: '2026-05-04T04:18:08', tx: '2026-05-03T22:18:00', cap: '2026-05-11T15:19:00', efs: 'SUCCESS', mode: 'CRITICAL', ref: 'SB-5821353-1526967758' },
  { recordId: '025', company: 'FAVELA LOGISTIXS INC', contractId: '871395', carrierId: '5821630', card: '7083050030093497944', cash: 363.66, child: 363.66, pre: 701.55, net: 635.34, gal: 124.32, loc: 'LOVES #349 TRAVEL STOP', state: 'AZ', status: 'IN_DEAD_ZONE', dzh: 14.92, dzu: '2026-05-04T13:12:06', tx: '2026-05-03T22:17:00', cap: '2026-05-11T15:19:00', efs: 'SUCCESS', mode: 'CRITICAL', ref: 'SB-5821630-1526967621' },
  { recordId: '024', company: 'AZSAD LLC', contractId: '868317', carrierId: '5819777', card: '7083050030196107820', cash: 166.65, child: 166.65, pre: 333.30, net: 612.38, gal: 116.76, loc: 'LOVES #272 TRAVEL STOP', state: 'AZ', status: 'IN_DEAD_ZONE', dzh: 14.01, dzu: '2026-05-04T12:04:40', tx: '2026-05-03T22:04:00', cap: '2026-05-11T15:19:00', efs: 'SUCCESS', mode: 'CRITICAL', ref: 'SB-5819777-1526965886' },
  { recordId: '023', company: 'RAHMA CARRIERS LLC', contractId: '855120', carrierId: '5810044', card: '7083050030771204410', cash: 884.10, child: 884.10, pre: 1005.22, net: 120.18, gal: 201.45, loc: 'PILOT #438', state: 'TX', status: 'READY', dzh: 6, dzu: '2026-05-04T05:01:00', tx: '2026-05-03T21:44:00', cap: '2026-05-11T15:19:00', efs: 'SUCCESS', mode: 'CRITICAL', ref: 'SB-5810044-1526960012' },
  { recordId: '022', company: 'BLUE RIDGE HAULERS', contractId: '849901', carrierId: '5803311', card: '7083050030551209984', cash: 241.39, child: 241.39, pre: 389.00, net: 455.61, gal: 88.10, loc: 'TA COMMERCE CITY', state: 'CO', status: 'IN_DEAD_ZONE', dzh: 12.40, dzu: '2026-05-04T11:18:00', tx: '2026-05-03T21:30:00', cap: '2026-05-11T15:19:00', efs: 'SUCCESS', mode: 'WARNING', ref: 'SB-5803311-1526955431' },
];

export function deadZoneCount(): number {
  return SMART_BALANCE_EVENTS.filter((e) => e.status === 'IN_DEAD_ZONE').length;
}

export function readyCount(): number {
  return SMART_BALANCE_EVENTS.filter((e) => e.status === 'READY').length;
}

export function sweptToday(): number {
  return SMART_BALANCE_EVENTS.reduce((s, e) => s + e.child, 0);
}

// ---- Event Audits ----

export type AuditType = 'SWEEP' | 'TOPUP';
export type AuditStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND';

export interface EventAudit {
  id: string;
  company: string;
  ref: string;
  carrier: string;
  type: AuditType;
  status: AuditStatus;
  amount: number;
  by: string;
  mode: 'CRITICAL' | 'WARNING';
  at: string; // iso
  efs: string;
}

export const EVENT_AUDITS: EventAudit[] = [
  { id: 'AUD-9001', company: 'ALI UZ EXPRESS LLC', ref: 'SB-5794572', carrier: '5794572', type: 'SWEEP', status: 'SUCCESS', amount: 102.67, by: 'cron', mode: 'CRITICAL', at: '2026-05-04T07:03:11', efs: 'OK · receipt 99183-AA' },
  { id: 'AUD-9002', company: 'JOURNEY LOGISTICS INC', ref: 'SB-5821353', carrier: '5821353', type: 'SWEEP', status: 'SUCCESS', amount: 529.77, by: 'cron', mode: 'CRITICAL', at: '2026-05-04T07:03:08', efs: 'OK · receipt 99183-AB' },
  { id: 'AUD-9003', company: 'RAHMA CARRIERS LLC', ref: 'SB-5810044', carrier: '5810044', type: 'SWEEP', status: 'SUCCESS', amount: 884.10, by: 'cron', mode: 'CRITICAL', at: '2026-05-04T07:03:02', efs: 'OK · receipt 99183-AC' },
  { id: 'AUD-9004', company: 'OASIS FREIGHT CO', ref: 'SB-5790221', carrier: '5790221', type: 'TOPUP', status: 'SUCCESS', amount: 1500.00, by: 'D. Whitfield', mode: 'CRITICAL', at: '2026-05-04T06:40:55', efs: 'OK · receipt 99180-TA' },
  { id: 'AUD-9005', company: 'BLUE RIDGE HAULERS', ref: 'SB-5803311', carrier: '5803311', type: 'SWEEP', status: 'FAILED', amount: 241.39, by: 'cron', mode: 'WARNING', at: '2026-05-04T07:02:59', efs: 'EFS timeout — will retry' },
  { id: 'AUD-9006', company: 'AZSAD LLC', ref: 'SB-5819777', carrier: '5819777', type: 'SWEEP', status: 'NOT_FOUND', amount: 166.65, by: 'cron', mode: 'CRITICAL', at: '2026-05-04T07:02:50', efs: 'Card not yet posted' },
  { id: 'AUD-9007', company: 'ZHU LLC', ref: 'SB-5799480', carrier: '5799480', type: 'SWEEP', status: 'SUCCESS', amount: 175.52, by: 'cron', mode: 'CRITICAL', at: '2026-05-04T07:02:44', efs: 'OK · receipt 99183-AD' },
  { id: 'AUD-9008', company: 'MERIDIAN TRANSPORT', ref: 'SB-5777010', carrier: '5777010', type: 'TOPUP', status: 'SUCCESS', amount: 2000.00, by: 'D. Whitfield', mode: 'CRITICAL', at: '2026-05-03T18:22:10', efs: 'OK · receipt 99044-TB' },
];

// ---- Transactions ----

export type PaymentTerms = 'LOC' | 'Prepay' | 'WEX';
export type FuelGrade = 'ULSD' | 'DEF';

export interface TransactionLine {
  txId: string;
  company: string;
  carrier: string;
  card: string;
  terms: PaymentTerms;
  active: boolean;
  grade: FuelGrade;
  gal: number;
  ppu: number;
  retail: number;
  disc: number;
  amount: number;
  loc: string;
  state: string;
  date: string; // iso
}

export const TRANSACTION_LINES: TransactionLine[] = [
  { txId: 'TX-1526969583', company: 'ALI UZ EXPRESS LLC', carrier: '5794572', card: '7083050030582197211', terms: 'LOC', active: true, grade: 'ULSD', gal: 138.86, ppu: 3.892, retail: 4.129, disc: 32.91, amount: 540.45, loc: 'LOVES #262 TRAVEL STOP', state: 'NM', date: '2026-06-28T22:31:00' },
  { txId: 'TX-1526969583', company: 'ALI UZ EXPRESS LLC', carrier: '5794572', card: '7083050030582197211', terms: 'LOC', active: true, grade: 'DEF', gal: 9.20, ppu: 2.110, retail: 2.350, disc: 2.21, amount: 19.41, loc: 'LOVES #262 TRAVEL STOP', state: 'NM', date: '2026-06-28T22:31:00' },
  { txId: 'TX-1526967863', company: 'ZHU LLC', carrier: '5799480', card: '7083050030498467559', terms: 'Prepay', active: true, grade: 'ULSD', gal: 115.24, ppu: 3.744, retail: 3.999, disc: 29.40, amount: 431.46, loc: 'MAVERIK LITTLEFIELD #766', state: 'AZ', date: '2026-06-28T22:19:00' },
  { txId: 'TX-1526967758', company: 'JOURNEY LOGISTICS INC', carrier: '5821353', card: '7083050030499447998', terms: 'LOC', active: true, grade: 'ULSD', gal: 50.02, ppu: 3.810, retail: 4.050, disc: 12.00, amount: 190.58, loc: 'TA FLORENCE', state: 'KY', date: '2026-06-28T22:18:00' },
  { txId: 'TX-1526967621', company: 'FAVELA LOGISTIXS INC', carrier: '5821630', card: '7083050030093497944', terms: 'WEX', active: true, grade: 'ULSD', gal: 124.32, ppu: 3.901, retail: 4.155, disc: 31.58, amount: 485.05, loc: 'LOVES #349 TRAVEL STOP', state: 'AZ', date: '2026-06-27T22:17:00' },
  { txId: 'TX-1526965886', company: 'AZSAD LLC', carrier: '5819777', card: '7083050030196107820', terms: 'LOC', active: true, grade: 'ULSD', gal: 116.76, ppu: 3.755, retail: 3.999, disc: 28.49, amount: 438.43, loc: 'LOVES #272 TRAVEL STOP', state: 'AZ', date: '2026-06-27T22:04:00' },
  { txId: 'TX-1526960012', company: 'RAHMA CARRIERS LLC', carrier: '5810044', card: '7083050030771204410', terms: 'LOC', active: true, grade: 'ULSD', gal: 201.45, ppu: 3.688, retail: 3.950, disc: 52.78, amount: 742.95, loc: 'PILOT #438', state: 'TX', date: '2026-06-27T21:44:00' },
  { txId: 'TX-1526955431', company: 'BLUE RIDGE HAULERS', carrier: '5803311', card: '7083050030551209984', terms: 'Prepay', active: false, grade: 'ULSD', gal: 88.10, ppu: 3.999, retail: 4.210, disc: 18.59, amount: 352.31, loc: 'TA COMMERCE CITY', state: 'CO', date: '2026-06-26T21:30:00' },
  { txId: 'TX-1526944120', company: 'MERIDIAN TRANSPORT', carrier: '5777010', card: '7083050030220114567', terms: 'LOC', active: true, grade: 'ULSD', gal: 162.04, ppu: 3.722, retail: 3.980, disc: 41.81, amount: 603.11, loc: 'FLYING J #618', state: 'OK', date: '2026-06-26T20:12:00' },
];

// ---- Clients ----

export type InvoiceStatus = 'PAID' | 'OVERDUE' | 'PARTIALLY_PAID';

export interface ClientInvoice {
  n: string;
  due: string;
  st: InvoiceStatus;
  total: number;
  paid: number;
  open: number;
  over: number;
}

export type PaymentSource = 'MX' | 'Zelle' | 'Chase' | 'Stripe';
export type PaymentStatus = 'APPROVED' | 'POSTED' | 'SUCCESS' | 'DECLINED';

export interface ClientPayment {
  src: PaymentSource;
  date: string;
  det: string;
  st: PaymentStatus;
  amt: number;
}

export interface ClientFuel {
  date: string;
  loc: string;
  grade: FuelGrade;
  gal: number;
  ppu: number;
  amt: number;
}

export interface ClientSummary {
  billed: number;
  paid: number;
  open: number;
  paidCount: number;
  openCount: number;
  total: number;
}

export interface Client {
  carrier: string;
  dot: string;
  company: string;
  city: string;
  state: string;
  active: boolean;
  terms: PaymentTerms;
  suspended: boolean;
  wex: boolean;
  debt: number;
  debtDays: number;
  overdue: number;
  credit: string; // '' | '25,000.00' | 'WEX'
  email: string;
  phone: string;
  agent: string;
  deal: string;
  stage: string;
  summary: ClientSummary;
  invoices: ClientInvoice[];
  payments: ClientPayment[];
  fuel: ClientFuel[];
}

export const CLIENTS: Client[] = [
  {
    carrier: '5794572', dot: '3982017', company: 'ALI UZ EXPRESS LLC', city: 'Albuquerque', state: 'NM',
    active: true, terms: 'LOC', suspended: false, wex: false, debt: 0, debtDays: 0, overdue: 0, credit: '25,000.00',
    email: 'ops@aliuzexpress.com', phone: '(505) 555-0142', agent: 'M. Okafor', deal: 'Ali Uz — LOC 25k', stage: 'Active Client',
    summary: { billed: 48210.55, paid: 48210.55, open: 0, paidCount: 14, openCount: 0, total: 14 },
    invoices: [
      { n: 'INV-20418', due: '2026-06-15', st: 'PAID', total: 3540.20, paid: 3540.20, open: 0.00, over: 0 },
      { n: 'INV-20392', due: '2026-05-15', st: 'PAID', total: 4118.90, paid: 4118.90, open: 0.00, over: 0 },
      { n: 'INV-20355', due: '2026-04-15', st: 'PAID', total: 2980.10, paid: 2980.10, open: 0.00, over: 0 },
    ],
    payments: [
      { src: 'MX', date: '2026-06-14', det: 'Visa ••4821 · INV 20418', st: 'APPROVED', amt: 3540.20 },
      { src: 'Zelle', date: '2026-05-14', det: 'Ali Uz Express · ZL-77120', st: 'POSTED', amt: 4118.90 },
    ],
    fuel: [
      { date: '2026-06-28', loc: 'LOVES #262, NM', grade: 'ULSD', gal: 138.86, ppu: 3.892, amt: 540.45 },
      { date: '2026-06-21', loc: 'PILOT #211, NM', grade: 'ULSD', gal: 142.10, ppu: 3.870, amt: 549.93 },
    ],
  },
  {
    carrier: '5803311', dot: '3711902', company: 'BLUE RIDGE HAULERS', city: 'Commerce City', state: 'CO',
    active: false, terms: 'Prepay', suspended: true, wex: false, debt: 4820.50, debtDays: 47, overdue: 3, credit: '10,000.00',
    email: 'billing@blueridgehaul.com', phone: '(303) 555-0199', agent: 'S. Patel', deal: 'Blue Ridge — Prepay', stage: 'Collections',
    summary: { billed: 21450.00, paid: 16629.50, open: 4820.50, paidCount: 6, openCount: 3, total: 9 },
    invoices: [
      { n: 'INV-20401', due: '2026-05-12', st: 'OVERDUE', total: 1820.50, paid: 0.00, open: 1820.50, over: 49 },
      { n: 'INV-20377', due: '2026-05-02', st: 'OVERDUE', total: 1500.00, paid: 0.00, open: 1500.00, over: 59 },
      { n: 'INV-20340', due: '2026-04-22', st: 'PARTIALLY_PAID', total: 2500.00, paid: 1000.00, open: 1500.00, over: 69 },
    ],
    payments: [{ src: 'Chase', date: '2026-04-20', det: 'ACH · #88231', st: 'POSTED', amt: 1000.00 }],
    fuel: [{ date: '2026-06-26', loc: 'TA COMMERCE CITY, CO', grade: 'ULSD', gal: 88.10, ppu: 3.999, amt: 352.31 }],
  },
  {
    carrier: '5810044', dot: '3855221', company: 'RAHMA CARRIERS LLC', city: 'Laredo', state: 'TX',
    active: true, terms: 'LOC', suspended: false, wex: false, debt: 1240.18, debtDays: 12, overdue: 1, credit: '40,000.00',
    email: 'accounts@rahmacarriers.com', phone: '(956) 555-0173', agent: 'M. Okafor', deal: 'Rahma — LOC 40k', stage: 'Active Client',
    summary: { billed: 96320.40, paid: 95080.22, open: 1240.18, paidCount: 22, openCount: 1, total: 23 },
    invoices: [
      { n: 'INV-20431', due: '2026-06-22', st: 'OVERDUE', total: 1240.18, paid: 0.00, open: 1240.18, over: 12 },
      { n: 'INV-20410', due: '2026-06-08', st: 'PAID', total: 5210.00, paid: 5210.00, open: 0.00, over: 0 },
    ],
    payments: [
      { src: 'Stripe', date: '2026-06-07', det: 'MC ••9920 · INV 20410', st: 'SUCCESS', amt: 5210.00 },
      { src: 'MX', date: '2026-05-30', det: 'Visa ••3318', st: 'APPROVED', amt: 4880.10 },
    ],
    fuel: [{ date: '2026-06-27', loc: 'PILOT #438, TX', grade: 'ULSD', gal: 201.45, ppu: 3.688, amt: 742.95 }],
  },
  {
    carrier: '5821353', dot: '3901144', company: 'JOURNEY LOGISTICS INC', city: 'Florence', state: 'KY',
    active: true, terms: 'LOC', suspended: false, wex: false, debt: 0, debtDays: 0, overdue: 0, credit: '30,000.00',
    email: 'ap@journeylog.com', phone: '(859) 555-0120', agent: 'T. Nguyen', deal: 'Journey — LOC 30k', stage: 'Active Client',
    summary: { billed: 33820.00, paid: 33820.00, open: 0, paidCount: 11, openCount: 0, total: 11 },
    invoices: [{ n: 'INV-20425', due: '2026-06-18', st: 'PAID', total: 2910.40, paid: 2910.40, open: 0.00, over: 0 }],
    payments: [{ src: 'Zelle', date: '2026-06-17', det: 'Journey Logistics · ZL-81002', st: 'POSTED', amt: 2910.40 }],
    fuel: [{ date: '2026-06-28', loc: 'TA FLORENCE, KY', grade: 'ULSD', gal: 50.02, ppu: 3.810, amt: 190.58 }],
  },
  {
    carrier: '5821630', dot: '3912550', company: 'FAVELA LOGISTIXS INC', city: 'Phoenix', state: 'AZ',
    active: true, terms: 'WEX', suspended: false, wex: true, debt: 0, debtDays: 0, overdue: 0, credit: 'WEX',
    email: 'finance@favelalog.com', phone: '(602) 555-0188', agent: 'S. Patel', deal: 'Favela — WEX funded', stage: 'Active Client',
    summary: { billed: 18900.00, paid: 18900.00, open: 0, paidCount: 7, openCount: 0, total: 7 },
    invoices: [{ n: 'INV-20419', due: '2026-06-16', st: 'PAID', total: 2310.00, paid: 2310.00, open: 0.00, over: 0 }],
    payments: [{ src: 'MX', date: '2026-06-15', det: 'WEX settlement', st: 'APPROVED', amt: 2310.00 }],
    fuel: [{ date: '2026-06-27', loc: 'LOVES #349, AZ', grade: 'ULSD', gal: 124.32, ppu: 3.901, amt: 485.05 }],
  },
  {
    carrier: '5777010', dot: '3640881', company: 'MERIDIAN TRANSPORT', city: 'Tulsa', state: 'OK',
    active: true, terms: 'LOC', suspended: false, wex: false, debt: 0, debtDays: 0, overdue: 0, credit: '50,000.00',
    email: 'billing@meridiantransport.com', phone: '(918) 555-0155', agent: 'T. Nguyen', deal: 'Meridian — LOC 50k', stage: 'Active Client',
    summary: { billed: 142500.00, paid: 142500.00, open: 0, paidCount: 31, openCount: 0, total: 31 },
    invoices: [{ n: 'INV-20428', due: '2026-06-20', st: 'PAID', total: 6030.00, paid: 6030.00, open: 0.00, over: 0 }],
    payments: [{ src: 'Chase', date: '2026-06-19', det: 'ACH · #90114', st: 'POSTED', amt: 6030.00 }],
    fuel: [{ date: '2026-06-26', loc: 'FLYING J #618, OK', grade: 'ULSD', gal: 162.04, ppu: 3.722, amt: 603.11 }],
  },
  {
    carrier: '5790221', dot: '3588204', company: 'OASIS FREIGHT CO', city: 'El Paso', state: 'TX',
    active: false, terms: 'Prepay', suspended: false, wex: false, debt: 920.00, debtDays: 33, overdue: 2, credit: '8,000.00',
    email: 'oasisfreight@mail.com', phone: '(915) 555-0166', agent: 'M. Okafor', deal: 'Oasis — Prepay', stage: 'At Risk',
    summary: { billed: 14200.00, paid: 13280.00, open: 920.00, paidCount: 5, openCount: 2, total: 7 },
    invoices: [
      { n: 'INV-20388', due: '2026-05-20', st: 'OVERDUE', total: 520.00, paid: 0.00, open: 520.00, over: 41 },
      { n: 'INV-20370', due: '2026-05-28', st: 'OVERDUE', total: 400.00, paid: 0.00, open: 400.00, over: 33 },
    ],
    payments: [{ src: 'Zelle', date: '2026-05-10', det: 'Oasis Freight · ZL-70551', st: 'POSTED', amt: 1200.00 }],
    fuel: [{ date: '2026-06-20', loc: 'PILOT #92, TX', grade: 'ULSD', gal: 98.40, ppu: 3.840, amt: 377.86 }],
  },
];

// ---- Dashboard: Debtors ----

export interface DashboardDebtor {
  company: string;
  carrier: string;
  agent: string;
  terms: PaymentTerms;
  suspended: boolean;
  days: number;
  inv: number;
  debt: number;
}

export const DASHBOARD_DEBTORS: DashboardDebtor[] = [
  { company: 'APEX TRUCKING LLC', carrier: '5744120', agent: 'S. Patel', terms: 'LOC', suspended: true, days: 95, inv: 5, debt: 9240.00 },
  { company: 'IRONHORSE FREIGHT', carrier: '5760455', agent: 'M. Okafor', terms: 'Prepay', suspended: false, days: 62, inv: 4, debt: 7310.00 },
  { company: 'BLUE RIDGE HAULERS', carrier: '5803311', agent: 'S. Patel', terms: 'Prepay', suspended: true, days: 47, inv: 3, debt: 4820.50 },
  { company: 'CEDAR LINE EXPRESS', carrier: '5712908', agent: 'T. Nguyen', terms: 'LOC', suspended: false, days: 71, inv: 3, debt: 3120.00 },
  { company: 'DELTA HAUL CO', carrier: '5798221', agent: 'M. Okafor', terms: 'LOC', suspended: false, days: 21, inv: 2, debt: 1580.00 },
  { company: 'RAHMA CARRIERS LLC', carrier: '5810044', agent: 'M. Okafor', terms: 'LOC', suspended: false, days: 12, inv: 1, debt: 1240.18 },
  { company: 'OASIS FREIGHT CO', carrier: '5790221', agent: 'M. Okafor', terms: 'Prepay', suspended: false, days: 33, inv: 2, debt: 920.00 },
  { company: 'SUNRISE LOGISTICS', carrier: '5821990', agent: 'T. Nguyen', terms: 'LOC', suspended: false, days: 8, inv: 1, debt: 640.00 },
];

// ---- Dashboard: Payments ----

export interface DashboardPayment {
  src: PaymentSource;
  date: string;
  det: string;
  st: PaymentStatus;
  amt: number;
}

export const DASHBOARD_PAYMENTS: DashboardPayment[] = [
  { src: 'MX', date: '2026-06-28', det: 'Visa ••4821 · ALI UZ EXPRESS · INV 20418', st: 'APPROVED', amt: 3540.20 },
  { src: 'Stripe', date: '2026-06-28', det: 'MC ••9920 · RAHMA CARRIERS · INV 20410', st: 'SUCCESS', amt: 5210.00 },
  { src: 'Zelle', date: '2026-06-27', det: 'Journey Logistics · ZL-81002', st: 'POSTED', amt: 2910.40 },
  { src: 'Chase', date: '2026-06-27', det: 'ACH · Meridian Transport · #90114', st: 'POSTED', amt: 6030.00 },
  { src: 'MX', date: '2026-06-26', det: 'Amex ••1007 · Favela Logistixs', st: 'APPROVED', amt: 2310.00 },
  { src: 'Stripe', date: '2026-06-25', det: 'Visa ••5540 · Oasis Freight', st: 'DECLINED', amt: 520.00 },
  { src: 'Zelle', date: '2026-06-24', det: 'Cedar Line Express · ZL-80911', st: 'POSTED', amt: 1800.00 },
  { src: 'Chase', date: '2026-06-23', det: 'ACH · Delta Haul Co · #90088', st: 'POSTED', amt: 1580.00 },
  { src: 'MX', date: '2026-06-22', det: 'Visa ••3318 · Rahma Carriers', st: 'APPROVED', amt: 4880.10 },
];

// ---- Dashboard: Fueling Patterns ----

export interface DowVolume {
  dow: number; // 0 = Sun
  name: string;
  tx: number;
  spend: number;
  gal: number;
  weekend: boolean;
}

export const DOW_VOLUME: DowVolume[] = [
  { dow: 0, name: 'Sun', tx: 312, spend: 118400, gal: 31200, weekend: true },
  { dow: 1, name: 'Mon', tx: 540, spend: 205600, gal: 54100, weekend: false },
  { dow: 2, name: 'Tue', tx: 588, spend: 223900, gal: 58900, weekend: false },
  { dow: 3, name: 'Wed', tx: 602, spend: 229100, gal: 60300, weekend: false },
  { dow: 4, name: 'Thu', tx: 631, spend: 240800, gal: 63200, weekend: false },
  { dow: 5, name: 'Fri', tx: 704, spend: 268500, gal: 70600, weekend: false },
  { dow: 6, name: 'Sat', tx: 398, spend: 151200, gal: 39800, weekend: true },
];

export interface HourVolume {
  hour: number;
  tx: number;
  spend: number;
  gal: number;
  peak: boolean;
}

const HOUR_BASE = [4, 3, 2, 2, 3, 8, 22, 34, 30, 24, 20, 18, 17, 19, 28, 33, 31, 27, 19, 14, 11, 9, 7, 5];
const PEAK_HOURS = new Set([6, 7, 8, 14, 15, 16, 17]);

export const HOUR_VOLUME: HourVolume[] = HOUR_BASE.map((base, hour) => ({
  hour,
  tx: base * 9,
  spend: base * 9 * 381,
  gal: base * 9 * 92,
  peak: PEAK_HOURS.has(hour),
}));

export interface TopLocation {
  loc: string;
  state: string;
  tx: number;
  gal: number;
  spend: number;
}

export const TOP_LOCATIONS: TopLocation[] = [
  { loc: 'LOVES #262 TRAVEL STOP', state: 'NM', tx: 142, gal: 18400, spend: 71200 },
  { loc: 'PILOT #438', state: 'TX', tx: 128, gal: 22100, spend: 81500 },
  { loc: 'TA FLORENCE', state: 'KY', tx: 96, gal: 9800, spend: 37300 },
  { loc: 'FLYING J #618', state: 'OK', tx: 88, gal: 14200, spend: 52900 },
  { loc: 'MAVERIK LITTLEFIELD #766', state: 'AZ', tx: 74, gal: 8600, spend: 32200 },
  { loc: 'TA COMMERCE CITY', state: 'CO', tx: 61, gal: 7300, spend: 29100 },
];

export interface TopCarrier {
  company: string;
  carrier: string;
  terms: PaymentTerms;
  tx: number;
  gal: number;
  spend: number;
}

export const TOP_CARRIERS: TopCarrier[] = [
  { company: 'MERIDIAN TRANSPORT', carrier: '5777010', terms: 'LOC', tx: 188, gal: 30400, spend: 113200 },
  { company: 'RAHMA CARRIERS LLC', carrier: '5810044', terms: 'LOC', tx: 154, gal: 28900, spend: 106800 },
  { company: 'ALI UZ EXPRESS LLC', carrier: '5794572', terms: 'LOC', tx: 131, gal: 18700, spend: 72900 },
  { company: 'FAVELA LOGISTIXS INC', carrier: '5821630', terms: 'WEX', tx: 98, gal: 13200, spend: 51400 },
  { company: 'JOURNEY LOGISTICS INC', carrier: '5821353', terms: 'LOC', tx: 76, gal: 6100, spend: 23800 },
  { company: 'ZHU LLC', carrier: '5799480', terms: 'Prepay', tx: 64, gal: 7900, spend: 30600 },
];

// ---- Dashboard: Segmentation ----

export type FuelingPattern = 'weekend_warrior' | 'night_owl' | 'early_bird' | 'weekday_only' | 'mixed';

export const PATTERN_META: Record<FuelingPattern, { label: string; color: string; count: number }> = {
  weekend_warrior: { label: 'Weekend Warriors', color: '#A855F7', count: 34 },
  night_owl: { label: 'Night Owls', color: '#6366F1', count: 58 },
  early_bird: { label: 'Early Birds', color: '#22C7F0', count: 71 },
  weekday_only: { label: 'Weekday Only', color: '#64748B', count: 120 },
  mixed: { label: 'Mixed', color: '#475569', count: 41 },
};

export interface TermsBreakdown {
  terms: PaymentTerms;
  clients: number;
  tx: number;
  spend: number;
  wknd: number;
  night: number;
}

export const TERMS_BREAKDOWN: TermsBreakdown[] = [
  { terms: 'LOC', clients: 128, tx: 1840, spend: 6210000, wknd: 18, night: 21 },
  { terms: 'Prepay', clients: 64, tx: 610, spend: 1980000, wknd: 24, night: 16 },
  { terms: 'WEX', clients: 32, tx: 288, spend: 1120000, wknd: 31, night: 27 },
];

export interface ClassifiedClient {
  carrier: string;
  company: string;
  pattern: FuelingPattern;
  terms: PaymentTerms;
  tx: number;
  spend: number;
  wknd: number;
  night: number;
  last: string;
}

export const CLASSIFIED_CLIENTS: ClassifiedClient[] = [
  { carrier: '5777010', company: 'MERIDIAN TRANSPORT', pattern: 'weekday_only', terms: 'LOC', tx: 188, spend: 113200, wknd: 6, night: 9, last: '2026-06-26' },
  { carrier: '5810044', company: 'RAHMA CARRIERS LLC', pattern: 'early_bird', terms: 'LOC', tx: 154, spend: 106800, wknd: 11, night: 4, last: '2026-06-27' },
  { carrier: '5794572', company: 'ALI UZ EXPRESS LLC', pattern: 'night_owl', terms: 'LOC', tx: 131, spend: 72900, wknd: 18, night: 62, last: '2026-06-28' },
  { carrier: '5821630', company: 'FAVELA LOGISTIXS INC', pattern: 'weekend_warrior', terms: 'WEX', tx: 98, spend: 51400, wknd: 48, night: 22, last: '2026-06-27' },
  { carrier: '5799480', company: 'ZHU LLC', pattern: 'night_owl', terms: 'Prepay', tx: 64, spend: 30600, wknd: 14, night: 55, last: '2026-06-28' },
  { carrier: '5821353', company: 'JOURNEY LOGISTICS INC', pattern: 'mixed', terms: 'LOC', tx: 76, spend: 23800, wknd: 27, night: 31, last: '2026-06-28' },
  { carrier: '5803311', company: 'BLUE RIDGE HAULERS', pattern: 'weekday_only', terms: 'Prepay', tx: 42, spend: 18900, wknd: 4, night: 7, last: '2026-06-26' },
];

// ---- formatting helpers ----

export function fmtCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCompact(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function maskCard(card: string): string {
  return '••••' + card.slice(-4);
}

// Fixed, not Date.now() — seed dates are anchored so labels stay correct
// regardless of when the app actually runs.
const TODAY = new Date('2026-06-28T12:00:00');

export function dateFull(iso: string): string {
  return new Date(iso.length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function dateShort(iso: string): string {
  return new Date(iso.length > 10 ? iso : iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

export function dateTimeFull(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function dateLabel(iso: string): string {
  const d = new Date(iso.length > 10 ? iso : iso + 'T12:00:00');
  const diff = Math.round((TODAY.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

export function txCount(): number {
  return new Set(TRANSACTION_LINES.map((t) => t.txId)).size;
}

export function fundedTotal(): number {
  return TRANSACTION_LINES.reduce((s, t) => s + t.amount, 0);
}

export function totalFuelGal(): number {
  return TRANSACTION_LINES.reduce((s, t) => s + t.gal, 0);
}

export function discountSaved(): number {
  return TRANSACTION_LINES.reduce((s, t) => s + t.disc, 0);
}

export function activeClientCount(): number {
  return CLIENTS.filter((c) => c.active).length;
}

export function debtorClientCount(): number {
  return CLIENTS.filter((c) => c.debt > 0).length;
}

export function suspendedCount(): number {
  return CLIENTS.filter((c) => c.suspended).length;
}

export function fueledRecentCount(): number {
  return CLIENTS.filter((c) => c.fuel.length > 0).length;
}
