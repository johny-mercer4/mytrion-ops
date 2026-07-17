/** Ticket list/chat chrome helpers (filters, SLA, priority colors, age labels). */
import { badge, type BadgeVM } from './salesData';
import { isTicketClosed, type TicketVM } from './live';
import { ticketStatusColor } from './ticketStatus';

export type TicketFilter = 'all' | 'overdue' | 'active' | 'closed';

export const TICKET_FILTERS: readonly { id: TicketFilter; label: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'active', label: 'In Progress' },
  { id: 'closed', label: 'Closed' },
];

export const tkPrioCol: Record<string, string> = {
  High: 'var(--danger)',
  Critical: 'var(--danger)',
  Normal: 'var(--accent)',
  Low: 'var(--muted)',
};

export const ageText = (h: number): string => {
  const hh = h || 0;
  return hh < 1 ? `${Math.max(1, Math.round(hh * 60))}m` : hh < 24 ? `${Math.round(hh)}h` : `${Math.round(hh / 24)}d`;
};

const slaTargetOf = (p: string): number => (p === 'High' || p === 'Critical' ? 4 : p === 'Low' ? 72 : 24);
const slaRemainOf = (t: TicketVM): number => slaTargetOf(t.priority) - (t.ageHrs || 0);
export const isOverdue = (t: TicketVM): boolean => !isTicketClosed(t.status) && slaRemainOf(t) < 0;

const fmtH = (h: number): string => {
  const x = Math.max(0, h);
  return x < 1 ? `${Math.max(1, Math.round(x * 60))}m` : x < 24 ? `${Math.round(x)}h` : `${Math.round(x / 24)}d`;
};

/** SLA chip for open tickets only — closed tickets rely on the status chip. */
export function slaInfo(t: TicketVM): { text: string; col: string } | null {
  if (isTicketClosed(t.status)) return null;
  const rem = slaRemainOf(t);
  if (rem < 0) return { text: `Overdue ${fmtH(-rem)}`, col: 'var(--danger)' };
  if (rem < slaTargetOf(t.priority) * 0.25) {
    return { text: `Due in ${fmtH(rem)}`, col: 'var(--warn)' };
  }
  return null;
}

export const statusBadgeOf = (st: string): BadgeVM => badge(st, ticketStatusColor(st));
