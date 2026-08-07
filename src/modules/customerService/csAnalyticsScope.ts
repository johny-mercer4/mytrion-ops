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
import { DESK_DEPARTMENTS, zohoDesk } from '../../integrations/zohoDesk.js';
import { executeZohoFunctionWithFallback } from '../../integrations/zohoFunctions.js';
import { resolveAllDepartmentAccess } from '../../lib/department.js';
import { listActiveUsersCached } from '../auth/actAsDirectory.js';
import { mytrionAccessService } from '../access/mytrionAccessService.js';
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

/** Deluge roster (legacy source) — the hosted fn is NOT_ACTIVE in the org right now. */
async function fetchRosterViaDeluge(): Promise<DeskAgent[]> {
  const payload = (await executeZohoFunctionWithFallback(
    ['mytrionGetDeskAgents'],
    { orgId: env.ZOHO_DESK_ORG_ID },
    { unwrap: 'successFlag' },
  )) as { data?: RosterAgentRaw[] };
  return (payload.data ?? [])
    .filter((raw) => raw.id !== undefined && raw.id !== null && raw.id !== '')
    .map((raw) => ({
      id: String(raw.id),
      name: raw.name ?? raw.fullName ?? null,
      email: (raw.email ?? raw.emailId ?? null)?.toLowerCase() ?? null,
    }));
}

/**
 * Desk agent roster, cached ~10 min. Primary source is the first-class Desk REST
 * integration (`GET /agents` — same auth as the ticket console); the widget's hosted
 * Deluge fn is kept as a fallback (it is currently NOT_ACTIVE in the org, verified live).
 */
export async function fetchDeskAgentRoster(): Promise<DeskAgent[]> {
  if (rosterCache && Date.now() - rosterCache.fetchedAt < ROSTER_TTL_MS) {
    return rosterCache.agents;
  }
  let agents: DeskAgent[];
  try {
    // CS-department only — an unscoped roster leaked other departments' agents into the
    // Analytics leaderboards (they resolve names off this map; see live.ts's ticketBoard/callBoard).
    agents = await zohoDesk.listAgents(DESK_DEPARTMENTS.cs);
  } catch {
    agents = await fetchRosterViaDeluge();
  }
  const byEmail = new Map<string, DeskAgent>();
  for (const agent of agents) {
    if (agent.email) byEmail.set(agent.email, agent);
  }
  rosterCache = { fetchedAt: Date.now(), agents, byEmail };
  return agents;
}

/**
 * The TRUE CS roster, for the Analytics leaderboard join — every Zoho user whose admin-granted
 * Mytrion access includes customer-service, cross-referenced with the Desk roster for their
 * assignee id.
 *
 * Desk DEPARTMENT membership (`fetchDeskAgentRoster` above) is NOT a safe proxy for "is this
 * really CS": agents get cross-assigned to the CS Desk department for ticket overflow while their
 * actual job — and their admin-granted Mytrion access — is Verification/Billing/etc. QA
 * 2026-08-07 caught exactly that (a Verification agent's tickets/calls showing on the CS
 * leaderboard even after the Desk-department scoping fix). This instead reuses the SAME access
 * authority `requireDepartment(..., 'customer-service')` gates the whole module on
 * (`mytrionAccessService`), so the leaderboard's notion of "who's CS" can never diverge from the
 * route's own gate again.
 *
 * ONE more filter on top of that access check: a marker-admin identity (profile "Administrator" /
 * role "Zoho Admin" / "CEO", etc — `resolveAllDepartmentAccess`, the same detector
 * `combineAccess` uses) is EXCLUDED regardless of what its access resolves to. `combineAccess`
 * expands an all-department grant's `accessibleMytrions` to literally every Mytrion id (see
 * mytrionAccessService.ts's `combineAccess`, `fullSet = allDept ? [...MYTRION_IDS] : allowed`) —
 * so "has customer-service access" is trivially true for every admin, and QA 2026-08-07 (round 2)
 * caught two IT admins (Islombek Mamurov, Amir Alimov — both profile "Administrator" / role "Zoho
 * Admin") on the leaderboard as a result. Being ALLOWED to see CS data (correct, for an admin) is
 * not the same question as WORKING CS tickets (what the leaderboard means to show) — only a
 * per-user override or role/profile default naming customer-service SPECIFICALLY should count, and
 * that is exactly what survives once marker-admins are excluded first.
 */
export async function fetchCsEligibleRoster(ctx: TenantContext): Promise<DeskAgent[]> {
  const [users, deskAgents] = await Promise.all([listActiveUsersCached(), fetchDeskAgentRoster()]);
  const deskByEmail = new Map(
    deskAgents.filter((a): a is DeskAgent & { email: string } => Boolean(a.email)).map((a) => [a.email, a]),
  );
  const effective = await mytrionAccessService.resolveBatch(
    ctx.tenantId,
    users.map((u) => ({
      tenantId: ctx.tenantId,
      zohoUserId: u.zohoUserId,
      profileName: u.profile,
      zohoRole: u.role,
      userName: u.name,
    })),
  );

  const out: DeskAgent[] = [];
  for (const u of users) {
    const access = effective.get(u.zohoUserId);
    if (!access) continue;
    const markerAdmin = resolveAllDepartmentAccess({ profile: u.profile, role: u.role, userName: u.name });
    if (markerAdmin) continue;
    const allowed = access.accessibleMytrions ?? [];
    if (!(access.allDepartmentAccess || allowed.includes('customer-service'))) continue;
    const email = u.email?.toLowerCase() ?? null;
    const desk = email ? deskByEmail.get(email) : undefined;
    // No Desk id ⇒ this person never has a Desk assignee_id to match, so the ticket board's join
    // naturally omits them (they can still surface on the email-keyed calls board).
    out.push({ id: desk?.id ?? '', name: u.name, email });
  }
  return out;
}

/** The caller's Desk agent id (email join), or null when no roster entry matches. */
export async function resolveDeskAgentId(ctx: TenantContext): Promise<string | null> {
  const email = ctx.email?.trim().toLowerCase();
  if (!email) return null;
  await fetchDeskAgentRoster();
  return rosterCache?.byEmail.get(email)?.id ?? null;
}
