import type { SalesAgentUsageRow } from '@/api/analytics';

export type UsageSortKey =
  | 'displayName'
  | 'activeSeconds'
  | 'onlineSeconds'
  | 'workspaceSessions'
  | 'uiActions'
  | 'workOutcomes'
  | 'ticketCreates'
  | 'automationSucceeded'
  | 'calls'
  | 'aiTurns'
  | 'lastActivityAt';

const NUMBER = new Intl.NumberFormat('en-US');

export function formatCount(value: number | null): string {
  return value == null ? '—' : NUMBER.format(value);
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds === 0) return '0m';
  if (seconds < 60) return '<1m';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
}

export function formatActivityTime(value: string | null, timeZone = 'America/New_York'): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

function comparable(row: SalesAgentUsageRow, key: UsageSortKey): number | string | null {
  if (key === 'displayName') return row.displayName;
  if (key === 'lastActivityAt') return row.lastActivityAt ? Date.parse(row.lastActivityAt) : null;
  if (key === 'ticketCreates') return totalTickets(row);
  return row[key];
}

/** Null means unavailable, not low usage, so it remains after measured values in either direction. */
export function sortUsageAgents(
  rows: readonly SalesAgentUsageRow[],
  key: UsageSortKey,
  direction: 'asc' | 'desc',
): SalesAgentUsageRow[] {
  return [...rows].sort((left, right) => {
    const a = comparable(left, key);
    const b = comparable(right, key);
    if (a == null && b == null) return left.displayName.localeCompare(right.displayName);
    if (a == null) return 1;
    if (b == null) return -1;
    const compared =
      typeof a === 'string' && typeof b === 'string'
        ? a.localeCompare(b)
        : Number(a) - Number(b);
    if (compared !== 0) return direction === 'asc' ? compared : -compared;
    return left.displayName.localeCompare(right.displayName);
  });
}

export function totalTickets(row: SalesAgentUsageRow): number | null {
  if (row.ticketCreates == null && row.escalationCreates == null) return null;
  return (row.ticketCreates ?? 0) + (row.escalationCreates ?? 0);
}
