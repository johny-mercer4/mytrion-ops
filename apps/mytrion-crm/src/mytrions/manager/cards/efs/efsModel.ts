/**
 * EFS Console — shared vocabulary for the dossier.
 *
 * The tab list is data because the console's whole trick is that ~37 read endpoints become four
 * destinations plus a row-driven inspector: a tab owns ONE list fetch, and everything id-keyed
 * (one card, one order, one policy) fires only when you click the row it belongs to. That is what
 * keeps a 90-endpoint vendor surface from turning into a menu of 90 links.
 */

export type EfsTabId = 'overview' | 'cards' | 'transactions' | 'money-codes';

export interface EfsTab {
  id: EfsTabId;
  label: string;
  /** The single catalog key this tab loads when opened. */
  fetcher: string;
  /** Copy for the empty state — written for the person, not the endpoint. */
  emptyLabel: string;
  /** Whether the tab needs the shared date window. */
  windowed: boolean;
}

export const EFS_TABS: readonly EfsTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    fetcher: 'carrier.snapshot',
    emptyLabel: 'EFS has no balance or contract record for this carrier.',
    windowed: false,
  },
  {
    id: 'cards',
    label: 'Cards',
    fetcher: 'carrier.cards',
    emptyLabel: 'This carrier holds no cards at EFS.',
    windowed: false,
  },
  {
    id: 'transactions',
    label: 'Transactions',
    fetcher: 'carrier.transactions',
    emptyLabel: 'No fuel transactions in this window.',
    windowed: true,
  },
  {
    id: 'money-codes',
    label: 'Money codes',
    fetcher: 'moneyCodes.list',
    emptyLabel: 'No money codes issued to this carrier in this window.',
    windowed: true,
  },
];

export function isEfsTab(value: string): value is EfsTabId {
  return EFS_TABS.some((tab) => tab.id === value);
}

const DAY_MS = 86_400_000;

/** ISO instant N days back — the shape the console fetchers take (not yyyy-mm-dd). */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US');
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

/** A client's headline state, as one badge. Order matters: the worst news wins. */
export function clientState(client: {
  isLocSuspended: boolean;
  isDebtor: boolean;
  isActive: boolean;
}): { label: string; tone: 'bad' | 'warn' | 'good' | 'muted' } {
  if (client.isLocSuspended) return { label: 'Suspended', tone: 'bad' };
  if (client.isDebtor) return { label: 'Debtor', tone: 'warn' };
  if (client.isActive) return { label: 'Active', tone: 'good' };
  return { label: 'Inactive', tone: 'muted' };
}
