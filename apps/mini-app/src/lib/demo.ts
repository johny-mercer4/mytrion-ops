/**
 * DEMO DATA for the self-service sheets (balance, transactions, invoices, payment, last-used,
 * tracking) and the home hero — the figures the design prototype ships. The real numbers come from
 * EFS/servercrm integrations that are NOT built yet; when those endpoints land, this module is the
 * single place to replace with fetches. Everything here is presentation-shaped, not secret.
 */

export interface BalanceTile {
  label: string;
  value: string;
  accent: boolean;
}

export const BALANCE_TILES: BalanceTile[] = [
  { label: 'EFS Balance', value: '$12,480.55', accent: false },
  { label: 'Credit Limit', value: '$20,000.00', accent: false },
  { label: 'Credit Used', value: '$12,480.55', accent: false },
  { label: 'Available', value: '$7,519.45', accent: true },
];

export const STATUS_TILES = [
  { label: 'Total debt', value: '$2,340.00' },
  { label: 'Open invoices', value: '3' },
  { label: 'Max days overdue', value: '12' },
  { label: 'Hard debtor', value: 'No' },
];

export interface StatusCard {
  num: string;
  status: string;
  last: string;
}

export function statusCards(role: 'fleet' | 'ownerOp' | 'driver', ownCard: string): StatusCard[] {
  if (role === 'driver' || role === 'ownerOp') return [{ num: ownCard, status: 'Active', last: 'Jul 8' }];
  return [
    { num: '7549', status: 'Active', last: 'Jul 8' },
    { num: '7722', status: 'Active', last: 'Jul 7' },
    { num: '8241', status: 'Frozen', last: 'Jun 30' },
  ];
}

export const PAYMENT_ROWS = [
  { label: 'Account type', value: 'LOC' },
  { label: 'Billing cycle', value: 'Weekly' },
  { label: 'Payment terms', value: 'Net 7' },
  { label: 'Method', value: 'ACH · ••••3321' },
];

export interface Txn {
  date: string;
  iso: string;
  location: string;
  amount: string;
  card: string;
}

export const TXN_ALL: Txn[] = [
  { date: 'Jul 8', iso: '2026-07-08', location: 'Pilot #442 · Dallas, TX', amount: '$418.20', card: '7549' },
  { date: 'Jul 7', iso: '2026-07-07', location: "Love's #310 · Amarillo, TX", amount: '$392.75', card: '7722' },
  { date: 'Jul 5', iso: '2026-07-05', location: 'TA #55 · Oklahoma City, OK', amount: '$405.10', card: '7549' },
  { date: 'Jun 30', iso: '2026-06-30', location: 'Flying J #88 · Wichita, KS', amount: '$378.40', card: '8241' },
  { date: 'Jun 27', iso: '2026-06-27', location: 'Pilot #201 · Denver, CO', amount: '$441.60', card: '7722' },
  { date: 'Jun 22', iso: '2026-06-22', location: 'TA #12 · Albuquerque, NM', amount: '$362.95', card: '7549' },
];

export interface InvoiceDoc {
  date: string;
  due: string;
  start: string;
  end: string;
  customerId: string;
  paid: boolean;
  total: string;
  rows: Array<{ d: string; a: string }>;
}

export const INVOICE_DOCS: Record<string, InvoiceDoc> = {
  '154441': {
    date: 'Jun 23, 2026', due: 'Jun 24, 2026', start: 'Jun 16, 2026', end: 'Jun 22, 2026',
    customerId: '4509', paid: false, total: '$2,104.66',
    rows: [
      { d: 'Total Payables', a: '$2,297.90' }, { d: 'Total Discounts', a: '-$193.24' },
      { d: 'EFS Checks', a: '$0.00' }, { d: 'Maintenance', a: '$0.00' },
      { d: 'Total Payables After Discount', a: '$2,104.66' }, { d: 'Non-Cash Adjustment', a: '$0.00' },
    ],
  },
  '154583': {
    date: 'Jun 30, 2026', due: 'Jul 1, 2026', start: 'Jun 23, 2026', end: 'Jun 29, 2026',
    customerId: '4509', paid: true, total: '$1,893.10',
    rows: [
      { d: 'Total Payables', a: '$2,065.40' }, { d: 'Total Discounts', a: '-$172.30' },
      { d: 'EFS Checks', a: '$0.00' }, { d: 'Maintenance', a: '$0.00' },
      { d: 'Total Payables After Discount', a: '$1,893.10' }, { d: 'Non-Cash Adjustment', a: '$0.00' },
    ],
  },
  '154697': {
    date: 'Jul 7, 2026', due: 'Jul 8, 2026', start: 'Jun 30, 2026', end: 'Jul 6, 2026',
    customerId: '4509', paid: true, total: '$1,520.54',
    rows: [
      { d: 'Total Payables', a: '$1,670.75' }, { d: 'Total Discounts', a: '-$150.21' },
      { d: 'EFS Checks', a: '$0.00' }, { d: 'Maintenance', a: '$0.00' },
      { d: 'Total Payables After Discount', a: '$1,520.54' }, { d: 'Non-Cash Adjustment', a: '$0.00' },
    ],
  },
};

export const HERO = {
  balance: '$12,480.55',
  sub: 'LOC · $7,519.45 available of $20,000',
  pct: 62,
};

export const TRACKING = (ownCard: string, isDriver: boolean) => ({
  card: isDriver ? ownCard : '8241',
  number: '1Z 999 AA1 01 2345 6784',
  status: 'Out for delivery',
  eta: 'Est. Jul 10',
});

export interface ActivityItem {
  id: string;
  /** i18n key for the action label (act.*). */
  actionKey: string;
  /** i18n key for the relative time (time.*), with optional {n}. */
  atKey: string;
  atN?: number;
  status: 'done' | 'pending' | 'failed';
}

export function seedActivities(isDriver: boolean): ActivityItem[] {
  if (isDriver) {
    return [
      { id: 'a1', actionKey: 'act.txns', atKey: 'time.min', atN: 2, status: 'done' },
      { id: 'a2', actionKey: 'act.tracking', atKey: 'time.yesterday', status: 'done' },
    ];
  }
  return [
    { id: 'a1', actionKey: 'act.balance', atKey: 'time.min', atN: 2, status: 'done' },
    { id: 'a2', actionKey: 'act.invoices', atKey: 'time.hour', atN: 1, status: 'done' },
    { id: 'a3', actionKey: 'act.txns', atKey: 'time.yesterday', status: 'done' },
  ];
}

const ACTIVITY_KEY: Record<string, string> = {
  balance: 'act.balance',
  status: 'act.status',
  txns: 'act.txns',
  invoices: 'act.invoices',
  payment: 'act.payment',
  lastused: 'act.lastused',
  tracking: 'act.tracking',
};

export function logActivity(list: ActivityItem[], key: string): ActivityItem[] {
  return [
    { id: 'a' + Date.now(), actionKey: ACTIVITY_KEY[key] ?? 'act.balance', atKey: 'time.justNow', status: 'done' as const },
    ...list,
  ].slice(0, 6);
}
