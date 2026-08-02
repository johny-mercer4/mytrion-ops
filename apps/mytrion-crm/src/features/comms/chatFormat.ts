/**
 * Presentation helpers shared by the console and the chat pane.
 *
 * Pure functions in their own module so they are unit-testable without rendering, and so the list and the
 * conversation cannot disagree about what "2h ago" or "Overdue" means.
 */
import type { TicketPriority, TicketStatus } from '@/api/comms';

/** Horizon tone token per status. Colour is always paired with the label, never used alone. */
const STATUS_TONE: Record<string, string> = {
  open: 'var(--tone-sky)',
  in_progress: 'var(--tone-cyan)',
  pending_requester: 'var(--tone-amber)',
  on_hold: 'var(--tone-slate)',
  escalated: 'var(--tone-violet)',
  resolved: 'var(--tone-emerald)',
  closed: 'var(--tone-slate)',
  cancelled: 'var(--tone-slate)',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  pending_requester: 'Awaiting reply',
  on_hold: 'On hold',
  escalated: 'Escalated',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function statusLabel(status: string): string {
  // Fall back to a de-snaked version rather than showing a raw enum: a status added server-side should
  // read as English here without a frontend deploy.
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

export function statusTone(status: string): string {
  return STATUS_TONE[status] ?? 'var(--tone-slate)';
}

const PRIORITY_TONE: Record<TicketPriority, string> = {
  low: 'var(--tone-slate)',
  medium: 'var(--tone-sky)',
  high: 'var(--tone-amber)',
  critical: 'var(--tone-rose)',
};

export function priorityTone(priority: string): string {
  return PRIORITY_TONE[priority as TicketPriority] ?? 'var(--tone-slate)';
}

/** Only high and critical earn a chip; tagging every ticket 'Medium' is noise that hides the urgent ones. */
export function showsPriority(priority: string): boolean {
  return priority === 'high' || priority === 'critical';
}

export function priorityLabel(priority: string): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

const OPEN_STATUSES: TicketStatus[] = [
  'open',
  'in_progress',
  'pending_requester',
  'on_hold',
  'escalated',
];

/** The "Open" filter's status list, as the comma-joined form the API takes. */
export const OPEN_STATUS_PARAM = OPEN_STATUSES.join(',');

export function isOpen(status: string): boolean {
  return (OPEN_STATUSES as string[]).includes(status);
}

/**
 * Compact relative time: 'now', '4m', '2h', '3d', then a date.
 *
 * Short on purpose — this sits in a list row where a full timestamp would push the subject out. The exact
 * time is always available in the row's `title` attribute.
 */
export function shortAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 45) return 'now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Wall-clock time for a message bubble. */
export function clockTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** 'Today' / 'Yesterday' / a date, for the divider between days of conversation. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** A day key for grouping — local date, so a divider lands where the reader's day actually changed. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toDateString();
}

/** 'Ali Karimov' → 'AK'. Falls back to a glyph so an avatar is never blank. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '·';
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return mb < 1024 ? `${mb.toFixed(mb < 10 ? 1 : 0)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * How long until (or since) an SLA deadline: '3h left' / '2h overdue'.
 *
 * Returns null when there is no deadline or the ticket is already settled, so a resolved ticket does not
 * advertise a countdown nobody is racing.
 */
export function slaCountdown(
  dueAt: string | null,
  status: string,
  now = Date.now(),
): { text: string; overdue: boolean } | null {
  if (!dueAt || !isOpen(status)) return null;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return null;
  const diffMins = Math.round((due - now) / 60000);
  const overdue = diffMins < 0;
  const mins = Math.abs(diffMins);
  const amount = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return { text: overdue ? `${amount} overdue` : `${amount} left`, overdue };
}
