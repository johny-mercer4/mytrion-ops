import type { LucideIcon } from 'lucide-react';
import {
  FileSpreadsheet,
  Fuel,
  Headphones,
  Landmark,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import type { AnalyticsDimension } from './data';

/** Sidebar analytics categories — each maps to a warehouse dimension + which filters apply. */
export type AnalyticsCategory =
  | 'sales'
  | 'crm'
  | 'customer-service'
  | 'finance'
  | 'billing'
  | 'transactions'
  | 'reports';

export interface CategoryDef {
  id: AnalyticsCategory;
  label: string;
  tone: string;
  icon: LucideIcon;
  keywords: string[];
  /** Warehouse snapshot dimension (omit for reports-only views). */
  dimension?: AnalyticsDimension;
  /** Which filter controls to show on this dashboard. */
  filters: Array<'agent' | 'range' | 'dates'>;
  description: string;
}

export const ANALYTICS_CATEGORIES: CategoryDef[] = [
  {
    id: 'sales',
    label: 'Sales',
    tone: 'var(--tone-sky)',
    icon: TrendingUp,
    keywords: ['cards', 'volume', 'gallons', 'revenue', 'companies', 'scorecard'],
    dimension: 'sales',
    filters: ['agent', 'range', 'dates'],
    description: 'Active companies, cards, volume, and revenue — with period-over-period deltas.',
  },
  {
    id: 'crm',
    label: 'CRM',
    tone: 'var(--tone-sky)',
    icon: Users,
    keywords: ['pipeline', 'deals', 'app fills', 'funnel', 'stages', 'conversion', 'leads'],
    dimension: 'pipeline',
    filters: ['agent', 'range', 'dates'],
    description: 'Deal funnel, app fills, stage conversion, and agent leaderboard.',
  },
  {
    id: 'customer-service',
    label: 'Customer Service',
    tone: 'var(--tone-teal)',
    icon: Headphones,
    keywords: ['tickets', 'desk', 'support', 'cs', 'resolution', 'backlog'],
    dimension: 'support',
    // No agent picker: Zoho Desk assignee ids are a different org id space from CRM zoho_users,
    // so Desk tickets cannot be attributed to a CRM agent (see modules/analytics/dimensions/support.ts).
    filters: ['range', 'dates'],
    description: 'Ticket volume, resolution time, backlog, and channel mix.',
  },
  {
    id: 'finance',
    label: 'Finance',
    tone: 'var(--tone-amber)',
    icon: Landmark,
    keywords: ['ar', 'debt', 'collections', 'finance', 'invoices', 'aging', 'overdue'],
    dimension: 'receivables',
    filters: ['agent', 'range', 'dates'],
    description: 'Invoicing, collections, and open receivables by age.',
  },
  {
    id: 'billing',
    label: 'Billing',
    tone: 'var(--tone-violet)',
    icon: Wallet,
    keywords: ['top-ups', 'balances', 'wallet', 'billing'],
    dimension: 'billing',
    filters: ['range', 'dates'],
    description: 'Client top-ups, wallet balances, and billing KPIs.',
  },
  {
    id: 'transactions',
    label: 'Transactions',
    tone: 'var(--tone-orange)',
    icon: Fuel,
    keywords: ['gallons', 'swipes', 'fuel', 'transactions'],
    dimension: 'transactions',
    filters: ['agent', 'range', 'dates'],
    description: 'Gallons, swipes, and fuel spend — filter by agent or date.',
  },
  {
    id: 'reports',
    label: 'Reports',
    tone: 'var(--tone-violet)',
    icon: FileSpreadsheet,
    keywords: ['export', 'sheet', 'catalog'],
    filters: [],
    description: 'Report catalog and exports.',
  },
];

export function categoryById(id: string | null): CategoryDef {
  return ANALYTICS_CATEGORIES.find((c) => c.id === id) ?? ANALYTICS_CATEGORIES[0]!;
}

/** Preset date windows for the filter bar. */
export type DateRangePreset = 'today' | 'last_7_days' | 'this_month' | 'custom';

export interface DashboardFilterParams {
  agentId: string | null;
  agentName: string | null;
  range: DateRangePreset;
  from: string | null; // YYYY-MM-DD
  to: string | null;
}

export const EMPTY_FILTERS: DashboardFilterParams = {
  agentId: null,
  agentName: null,
  range: 'this_month',
  from: null,
  to: null,
};

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default custom window = last 7 local calendar days (inclusive). */
export function defaultCustomRange(now = new Date()): { from: string; to: string } {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: isoDate(from), to: isoDate(to) };
}

/**
 * Read the DATE window from the URL. The agent is deliberately NOT read here — it comes from the
 * TopBar "View as" selection (see `mytrions/analyst/index.tsx`), so `agentId` / `agentName` are
 * always null on the way out and the caller overlays the impersonated identity.
 */
export function parseFilters(qs: URLSearchParams): DashboardFilterParams {
  const rangeRaw = qs.get('range');
  // Map legacy ?range=this_week → last_7_days (calendar week removed from the UI).
  const normalized = rangeRaw === 'this_week' ? 'last_7_days' : rangeRaw;
  const range: DateRangePreset =
    normalized === 'today' ||
    normalized === 'last_7_days' ||
    normalized === 'this_month' ||
    normalized === 'custom'
      ? normalized
      : 'this_month';
  const from = qs.get('from')?.trim() || null;
  const to = qs.get('to')?.trim() || null;
  if (range === 'custom' && (!from || !to)) {
    const d = defaultCustomRange();
    return { agentId: null, agentName: null, range, from: from ?? d.from, to: to ?? d.to };
  }
  return { agentId: null, agentName: null, range, from, to };
}

/**
 * Merge the date window into the current URL search params (preserves category).
 * Strips any legacy `agent` / `agentName` params — a stale one in a bookmarked URL must not
 * silently re-scope a dashboard that now follows "View as".
 */
export function writeFilters(qs: URLSearchParams, filters: DashboardFilterParams): URLSearchParams {
  const next = new URLSearchParams(qs);
  next.delete('agent');
  next.delete('agentName');
  next.set('range', filters.range);
  if (filters.range === 'custom' && filters.from) next.set('from', filters.from);
  else next.delete('from');
  if (filters.range === 'custom' && filters.to) next.set('to', filters.to);
  else next.delete('to');
  return next;
}
