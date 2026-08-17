/**
 * Verification inbox — what a message is called, and how it is grouped.
 *
 * The `mytrion_inbox_messages.type` column carries a dotted EVENT NAME
 * (`verification.application.created`), not a category. The list route's own `filter`
 * (`task | alert | reminder`) matches that column against Zoho's vocabulary — `'task'`,
 * `'warning'`, `'critical'` — so every verification message falls into `reminder` and the
 * server-side categories are useless here. The scopes below are therefore derived from the event
 * types actually PRESENT in the loaded page: a tab exists because messages of that kind exist.
 *
 * That is also why the design's six fixed scopes (New cases / Documents / Escalations / SLA) are
 * not hardcoded. Four of them have no producer — nothing writes a "documents received" or "SLA
 * breach" inbox message today — and a tab that can only ever read zero is a promise the product
 * does not keep.
 */
import type { InboxMessage } from '@/api/inbox';

export type InboxTone = 'info' | 'ok' | 'warn' | 'danger' | 'plain';

export interface TypeStyle {
  /** What the desk calls this kind of message. */
  label: string;
  tone: InboxTone;
  /** Material Symbols name — reinforcement beside the label, never the only channel. */
  icon: string;
}

/**
 * Event type → presentation, for the types that have a producer in this codebase.
 *
 * `verification.application.awaiting_intake` is addressed to the SALES owner, so a verification
 * reviewer normally never sees it; it is mapped anyway because an admin can View-as that agent.
 */
export const TYPE_STYLE: Record<string, TypeStyle> = {
  'verification.application.created': {
    label: 'New application',
    tone: 'info',
    icon: 'assignment_turned_in',
  },
  'verification.application.awaiting_intake': {
    label: 'Intake owed',
    tone: 'warn',
    icon: 'edit_note',
  },
  'verification.case.created': { label: 'New case', tone: 'info', icon: 'folder_open' },
  'verification.case.blacklisted': { label: 'Blacklisted', tone: 'danger', icon: 'block' },
};

/** Anything the desk has not taught this file about still reads as a sentence, not a code. */
export function styleFor(type: string): TypeStyle {
  const known = TYPE_STYLE[type];
  if (known) return known;
  return { label: humanizeType(type), tone: 'plain', icon: 'notifications' };
}

/**
 * `verification.limit.raised` → "Limit raised". A dotted event name is a developer's word; the
 * last two segments are the part that means something to a reviewer.
 */
export function humanizeType(type: string): string {
  const parts = type.split('.').filter(Boolean);
  const tail = parts.slice(-2).join(' ') || type;
  const words = tail.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isUnread(message: InboxMessage): boolean {
  return message.readAt == null;
}

/** The case a message points at. One parser for the module — see `verificationCaseUi`. */
export { caseIdFromInboxSource as caseIdFromSource } from '../verificationCaseUi';

export type Scope = string;

export interface ScopeTab {
  id: Scope;
  label: string;
  count: number;
}

/**
 * All / Unread, then one tab per event type present, most common first.
 *
 * Every count comes off the SAME rows the list renders, so a tab can never disagree with what
 * opening it shows.
 */
export function scopeTabs(messages: readonly InboxMessage[]): ScopeTab[] {
  const byType = new Map<string, number>();
  for (const m of messages) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);

  const typeTabs = [...byType.entries()]
    .sort((a, b) => b[1] - a[1] || styleFor(a[0]).label.localeCompare(styleFor(b[0]).label))
    .map(([type, count]) => ({ id: type, label: styleFor(type).label, count }));

  return [
    { id: 'all', label: 'All', count: messages.length },
    { id: 'unread', label: 'Unread', count: messages.filter(isUnread).length },
    ...typeTabs,
  ];
}

export function inScope(message: InboxMessage, scope: Scope): boolean {
  if (scope === 'all') return true;
  if (scope === 'unread') return isUnread(message);
  return message.type === scope;
}

/**
 * When it landed, in the shortest form that is still unambiguous.
 *
 * Today gets a clock, yesterday says so, this year drops the year. A reviewer scanning an inbox
 * wants "how long ago", and a full timestamp for every row is six columns of noise.
 */
export function whenLabel(iso: string, now: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const at = new Date(ms);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (ms >= startOfToday.getTime()) return `${time} today`;

  const startOfYesterday = startOfToday.getTime() - 86_400_000;
  if (ms >= startOfYesterday) return `Yesterday ${time}`;

  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  const date = at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date} ${time}`;
}

/** Full stamp for the detail panel, where there is room for the whole truth. */
export function fullWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "How it got here", from the message's own columns.
 *
 * Three facts and no more: when it was raised, who it is addressed to, and whether it has been
 * read. The design drew a routing history ("Routed to the Verification queue", "Assigned to …") —
 * `mytrion_inbox_messages` records no routing hops, so inventing them would put a fabricated audit
 * trail on a credit desk.
 */
export interface TimelineEvent {
  text: string;
  when: string;
}

export function timelineFor(message: InboxMessage): TimelineEvent[] {
  const out: TimelineEvent[] = [
    { text: `${styleFor(message.type).label} raised`, when: fullWhen(message.createdTime) },
  ];
  if (message.ownerName) {
    out.push({ text: `Addressed to ${message.ownerName}`, when: fullWhen(message.createdTime) });
  }
  out.push(
    message.readAt
      ? { text: 'Read', when: fullWhen(message.readAt) }
      : { text: 'Unread', when: '—' },
  );
  return out;
}
