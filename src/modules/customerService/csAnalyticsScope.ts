/**
 * CS analytics scoping — manager-tier resolution + the Desk-agent identity join.
 *
 * The DWH keys tickets by Desk `assignee_id` and calls by CRM owner EMAIL; a CRM session
 * carries neither, so the caller's Desk agent id is resolved by joining the Desk roster
 * (Deluge mytrionGetDeskAgents) on email. Non-managers are ALWAYS forced to their own
 * scope; an unmatched email degrades to "no data" (explicit unmatched flag), never to
 * org-wide numbers. Managers (role/profile marker, replaces the old widget's hardcoded
 * name allowlist) may scope freely or see org-wide aggregates.
 */
import { env } from '../../config/env.js';
import { executeZohoFunctionWithFallback } from '../../integrations/zohoFunctions.js';
import type { TenantContext } from '../../types/tenantContext.js';

const ROSTER_TTL_MS = 10 * 60 * 1000;

export interface DeskAgent {
  id: string;
  name: string | null;
  email: string | null;
}

interface RosterCache {
  fetchedAt: number;
  agents: DeskAgent[];
  byEmail: Map<string, DeskAgent>;
}

let rosterCache: RosterCache | null = null;

/** Test hook. */
export function invalidateRosterCache(): void {
  rosterCache = null;
}

function markers(): string[] {
  return env.CS_MANAGER_ROLE_MARKERS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Manager tier for the CS Mytrion (leaderboard, org-wide analytics, roster). Admin /
 * bypass / all-department access always qualifies; otherwise the caller's Zoho profile
 * or role must contain a CS_MANAGER_ROLE_MARKERS entry ("Customer Service Manager"
 * matches via 'manager').
 */
export function isCsManager(ctx: TenantContext): boolean {
  if (ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess) return true;
  const values = [...(ctx.profiles ?? []), ctx.callerRole ?? ''].map((v) => v.toLowerCase());
  return markers().some((m) => values.some((v) => v.includes(m)));
}

interface RosterAgentRaw {
  id?: string | number;
  name?: string;
  fullName?: string;
  email?: string;
  emailId?: string;
}

/** Desk agent roster via the hosted Deluge fn, cached ~10 min (widget parity). */
export async function fetchDeskAgentRoster(): Promise<DeskAgent[]> {
  if (rosterCache && Date.now() - rosterCache.fetchedAt < ROSTER_TTL_MS) {
    return rosterCache.agents;
  }
  const payload = (await executeZohoFunctionWithFallback(
    ['mytrionGetDeskAgents'],
    { orgId: env.ZOHO_DESK_ORG_ID },
    { unwrap: 'successFlag' },
  )) as { data?: RosterAgentRaw[] };
  const agents: DeskAgent[] = [];
  const byEmail = new Map<string, DeskAgent>();
  for (const raw of payload.data ?? []) {
    if (raw.id === undefined || raw.id === null || raw.id === '') continue;
    const agent: DeskAgent = {
      id: String(raw.id),
      name: raw.name ?? raw.fullName ?? null,
      email: (raw.email ?? raw.emailId ?? null)?.toLowerCase() ?? null,
    };
    agents.push(agent);
    if (agent.email) byEmail.set(agent.email, agent);
  }
  rosterCache = { fetchedAt: Date.now(), agents, byEmail };
  return agents;
}

/** The caller's Desk agent id (email join), or null when no roster entry matches. */
export async function resolveDeskAgentId(ctx: TenantContext): Promise<string | null> {
  const email = ctx.email?.trim().toLowerCase();
  if (!email) return null;
  await fetchDeskAgentRoster();
  return rosterCache?.byEmail.get(email)?.id ?? null;
}
