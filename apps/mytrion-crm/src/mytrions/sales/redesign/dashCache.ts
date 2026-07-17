/**
 * localStorage TTL cache for heavy Deluge dashboards (widget: 5 min sales cache).
 * Keyed by effective Zoho user id so act-as doesn't leak another agent's numbers.
 */
import { getSession } from '@/api/session';
import { getImpersonation } from '@/api/impersonation';

export const SALES_DASH_TTL_MS = 5 * 60 * 1000;
export const COMPANY_DASH_TTL_MS = 5 * 60 * 1000;

export function dashCacheUserId(): string {
  return getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? 'anon';
}

export function readDashCache<T>(prefix: string, ttlMs: number): { data: T; cachedAt: Date } | null {
  try {
    const uid = dashCacheUserId();
    const raw = localStorage.getItem(`${prefix}_${uid}`);
    const ts = localStorage.getItem(`${prefix}_ts_${uid}`);
    if (!raw || !ts) return null;
    const cachedAt = new Date(ts);
    if (Number.isNaN(cachedAt.getTime())) return null;
    if (Date.now() - cachedAt.getTime() >= ttlMs) return null;
    return { data: JSON.parse(raw) as T, cachedAt };
  } catch {
    return null;
  }
}

export function writeDashCache(prefix: string, data: unknown): Date {
  const uid = dashCacheUserId();
  const cachedAt = new Date();
  try {
    localStorage.setItem(`${prefix}_${uid}`, JSON.stringify(data));
    localStorage.setItem(`${prefix}_ts_${uid}`, cachedAt.toISOString());
  } catch {
    /* quota / private mode — ignore */
  }
  return cachedAt;
}

export function formatCachedAt(d: Date | null | undefined): string {
  if (!d) return '';
  try {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
  } catch {
    return d.toLocaleTimeString();
  }
}
