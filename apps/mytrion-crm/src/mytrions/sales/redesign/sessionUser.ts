/**
 * The signed-in worker as the Sales redesign displays them — name/first/initials/role derived
 * from the real session (api/session) and the admin "act as agent" selection. This is the single
 * source of truth for the user card, the Home greeting, and the copilot opener; no hardcoded
 * identity. Falls back to neutral labels only when there is somehow no session (never in prod).
 */
import { useMemo } from 'react';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';

export interface SessionUser {
  name: string;
  first: string;
  initials: string;
  role: string;
}

export function useSessionUser(): SessionUser {
  const { actingAs } = useImpersonation();
  const worker = getSession()?.worker;
  const name = actingAs?.name ?? worker?.userName ?? 'Agent';
  const role = actingAs?.role ?? actingAs?.profile ?? worker?.role ?? worker?.profile ?? 'Sales';
  return useMemo<SessionUser>(() => {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] ?? name;
    const initials = parts.map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '—';
    return { name, first, initials, role };
  }, [name, role]);
}
