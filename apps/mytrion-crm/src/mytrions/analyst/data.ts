/**
 * Analytics dashboard shapes + OFFLINE FALLBACK data.
 *
 * The live path is GET /v1/analytics/:dimension (warehouse-backed, ~2h snapshot cache) — see
 * api/analytics.ts and Dashboard.tsx. The blocks below render only when the backend is
 * unreachable/unconfigured, clearly labeled as sample data. Shapes mirror the backend's
 * modules/analytics/types.ts exactly so a live snapshot renders verbatim.
 */

export interface KpiStat {
  label: string;
  value: string;
  hint?: string;
  /** Optional trend pill: compares `current` vs `prev`; `higherIsBetter` decides good/bad colour. */
  delta?: { prev: number; current: number; higherIsBetter: boolean };
}

export interface TrendPoint {
  label: string;
  value: number;
  /** The trailing day is in-progress → rendered as a faded bar. */
  partial?: boolean;
}

export interface BreakdownItem {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'purple' | 'sky' | 'teal' | 'amber';
}

export interface LeaderboardRow {
  name: string;
  col1: number;
  col2: number | string;
  col3: number | string;
}

export interface AnalyticsBlock {
  label: string;
  /** One-line context under the KPI row. */
  caption: string;
  kpis: KpiStat[];
  trendLabel: string;
  trend: TrendPoint[];
  breakdownLabel: string;
  breakdown: BreakdownItem[];
  leaderboardLabel: string;
  leaderboardCols: [string, string, string];
  leaderboard: LeaderboardRow[];
}

export type AnalyticsDimension = 'pipeline' | 'transactions' | 'billing';

const DAYS_14 = [
  'Jun 19', 'Jun 20', 'Jun 21', 'Jun 22', 'Jun 23', 'Jun 24', 'Jun 25',
  'Jun 26', 'Jun 27', 'Jun 28', 'Jun 29', 'Jun 30', 'Jul 01', 'Jul 02',
];

/** Zip a 14-value series onto the shared day labels; the last day is marked partial. */
function series(values: number[]): TrendPoint[] {
  return values.map((value, i) => ({
    label: DAYS_14[i] ?? `d${i}`,
    value,
    ...(i === values.length - 1 ? { partial: true } : {}),
  }));
}

export const ANALYTICS: Record<AnalyticsDimension, AnalyticsBlock> = {
  pipeline: {
    label: 'Pipeline',
    caption: 'Deal flow and conversion across the sales org',
    kpis: [
      { label: 'New Leads', value: '342', delta: { prev: 298, current: 342, higherIsBetter: true } },
      { label: 'Conversion', value: '24.6%', delta: { prev: 22.1, current: 24.6, higherIsBetter: true } },
      { label: 'Avg Deal', value: '$18.4k', hint: 'first-year fuel volume' },
      { label: 'Win Rate', value: '61%', delta: { prev: 58, current: 61, higherIsBetter: true } },
    ],
    trendLabel: 'Deals created / day',
    trend: series([18, 24, 12, 9, 27, 31, 34, 29, 25, 19, 14, 28, 33, 17]),
    breakdownLabel: 'By stage',
    breakdown: [
      { label: 'Prospecting', value: 128, tone: 'sky' },
      { label: 'Qualified', value: 86, tone: 'info' },
      { label: 'Proposal', value: 54, tone: 'purple' },
      { label: 'Negotiation', value: 37, tone: 'warn' },
      { label: 'Won', value: 48, tone: 'good' },
      { label: 'Lost', value: 22, tone: 'bad' },
    ],
    leaderboardLabel: 'Top sales agents',
    leaderboardCols: ['Deals', 'Won', 'Conv %'],
    leaderboard: [
      { name: 'Aziz Karimov', col1: 74, col2: 46, col3: '62%' },
      { name: 'Dilnoza Rashidova', col1: 68, col2: 41, col3: '60%' },
      { name: 'Marcus Bell', col1: 59, col2: 33, col3: '56%' },
      { name: 'Sana Qodirova', col1: 52, col2: 28, col3: '54%' },
      { name: 'Jared Cole', col1: 44, col2: 21, col3: '48%' },
    ],
  },
  transactions: {
    label: 'Transactions',
    caption: 'Fueling activity and card spend across carriers',
    kpis: [
      { label: 'Gallons', value: '1.24M', delta: { prev: 1.11, current: 1.24, higherIsBetter: true } },
      { label: 'Fuel Spend', value: '$4.31M', delta: { prev: 3.98, current: 4.31, higherIsBetter: true } },
      { label: 'Transactions', value: '38.2k', delta: { prev: 35.9, current: 38.2, higherIsBetter: true } },
      { label: 'Avg / Txn', value: '$112.8', hint: 'blended fuel + fees' },
    ],
    trendLabel: 'Transactions / day (×1k)',
    trend: series([2.4, 2.9, 3.1, 1.8, 2.2, 3.4, 3.6, 3.2, 2.8, 2.1, 1.9, 3.0, 3.3, 1.6]),
    breakdownLabel: 'By product',
    breakdown: [
      { label: 'Diesel', value: 214, tone: 'info' },
      { label: 'DEF', value: 58, tone: 'teal' },
      { label: 'Reefer', value: 44, tone: 'purple' },
      { label: 'Gasoline', value: 39, tone: 'sky' },
      { label: 'Cash Advance', value: 27, tone: 'amber' },
      { label: 'Fees', value: 19, tone: 'neutral' },
    ],
    leaderboardLabel: 'Top carriers by volume',
    leaderboardCols: ['Txns', 'Gallons', 'Spend'],
    leaderboard: [
      { name: 'Grant Express LLC', col1: 4120, col2: '184k', col3: '$612k' },
      { name: 'Silk Road Freight', col1: 3380, col2: '151k', col3: '$503k' },
      { name: 'BE Diamond Inc', col1: 2870, col2: '129k', col3: '$441k' },
      { name: 'Great Way Inc', col1: 2410, col2: '108k', col3: '$372k' },
      { name: 'Citi Fuel Carriers', col1: 1980, col2: '92k', col3: '$318k' },
    ],
  },
  billing: {
    label: 'Billing',
    caption: 'Client top-ups, balances and receivables (month to date)',
    kpis: [
      { label: 'Top-ups', value: '318', delta: { prev: 287, current: 318, higherIsBetter: true } },
      { label: 'Top-up Volume', value: '$1.92M', delta: { prev: 1.71, current: 1.92, higherIsBetter: true } },
      { label: 'Avg Top-up', value: '$6.0k', hint: 'this month' },
      { label: 'Open Debtor Invoices', value: '42', hint: 'pending / partially paid' },
    ],
    trendLabel: 'Top-up $ / day',
    trend: series([88, 112, 64, 41, 96, 124, 131, 118, 92, 71, 55, 108, 126, 49]),
    breakdownLabel: 'Top-ups by company (this month)',
    breakdown: [
      { label: 'Grant Express LLC', value: 214, tone: 'good' },
      { label: 'Silk Road Freight', value: 168, tone: 'teal' },
      { label: 'BE Diamond Inc', value: 121, tone: 'sky' },
      { label: 'Great Way Inc', value: 96, tone: 'purple' },
      { label: 'Citi Fuel Carriers', value: 72, tone: 'amber' },
      { label: 'Others', value: 189, tone: 'neutral' },
    ],
    leaderboardLabel: 'Largest current balances',
    leaderboardCols: ['Balance', 'Top-ups (m)', 'Amount'],
    leaderboard: [
      { name: 'Grant Express LLC', col1: 48210, col2: 9, col3: '$48k' },
      { name: 'Silk Road Freight', col1: 39480, col2: 7, col3: '$39k' },
      { name: 'BE Diamond Inc', col1: 27950, col2: 6, col3: '$28k' },
      { name: 'Great Way Inc', col1: 21730, col2: 4, col3: '$22k' },
      { name: 'Citi Fuel Carriers', col1: 18010, col2: 4, col3: '$18k' },
    ],
  },
};

export const DIMENSIONS: { id: AnalyticsDimension; label: string }[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'billing', label: 'Billing' },
];
