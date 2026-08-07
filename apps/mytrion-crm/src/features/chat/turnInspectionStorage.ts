import type { TurnInspection } from './useChat';

const PREFIX = 'horizon.turn-inspector.v1';

function key(userId: string | undefined, conversationId: string): string {
  return `${PREFIX}:${encodeURIComponent(userId ?? 'anonymous')}:${encodeURIComponent(conversationId)}`;
}

function isInspection(value: unknown): value is TurnInspection {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<TurnInspection>;
  return typeof row.turnId === 'string' && typeof row.startedAt === 'string' && Array.isArray(row.steps);
}

/** Browser-local admin diagnostics, bounded by the reducer to the latest 80 structured steps. */
export function getTurnInspection(userId: string | undefined, conversationId: string): TurnInspection | null {
  try {
    const raw = localStorage.getItem(key(userId, conversationId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isInspection(parsed) ? { ...parsed, active: false } : null;
  } catch {
    return null;
  }
}

export function setTurnInspection(
  userId: string | undefined,
  conversationId: string,
  inspection: TurnInspection,
): void {
  try {
    localStorage.setItem(key(userId, conversationId), JSON.stringify({ ...inspection, active: false }));
  } catch {
    // Storage can be unavailable in private/embedded browser contexts; the live inspector still works.
  }
}

export function removeTurnInspection(userId: string | undefined, conversationId: string): void {
  try {
    localStorage.removeItem(key(userId, conversationId));
  } catch {
    // Non-fatal diagnostic cache cleanup.
  }
}
