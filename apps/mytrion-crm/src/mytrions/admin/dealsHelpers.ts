import type { AdminDeal, OwnerTimelineChange } from '../../api/adminDeals';
import type { AgentUser } from '../../api/agents';

export function dash(v: string | null | undefined): string {
  const t = v?.trim();
  return t || '—';
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60_000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 48) return `${hours}h ago`;
  return new Date(then).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function filterAgents(
  agents: AgentUser[],
  agentQuery: string,
  priorZohoUserId: string | null | undefined,
): AgentUser[] {
  const q = agentQuery.trim().toLowerCase();
  const base = !q
    ? agents
    : agents.filter((a) => {
        const blob = `${a.name ?? ''} ${a.email ?? ''} ${a.profile ?? ''} ${a.zohoUserId}`.toLowerCase();
        return blob.includes(q);
      });
  if (!priorZohoUserId) return base;
  return [...base].sort((a, b) => {
    if (a.zohoUserId === priorZohoUserId) return -1;
    if (b.zohoUserId === priorZohoUserId) return 1;
    return 0;
  });
}

export function filterDeals(
  deals: AdminDeal[],
  listFilter: string,
  timelineByDeal: Record<string, OwnerTimelineChange>,
): AdminDeal[] {
  const q = listFilter.trim().toLowerCase();
  if (!q) return deals;
  return deals.filter((d) => {
    const tl = timelineByDeal[d.id];
    const blob = [
      d.dealName,
      d.id,
      d.ownerName,
      d.accountName,
      d.carrierId,
      d.applicationId,
      tl?.previousOwnerName,
      tl?.newOwnerName,
      tl?.transferrerName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return blob.includes(q);
  });
}

