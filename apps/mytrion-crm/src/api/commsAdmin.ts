/**
 * Comms routing administration (/v1/comms/admin) — who an escalation goes to at each level.
 *
 * Everything the escalation ladder needs is a row edited here, not a constant in code:
 *   level 2  the reason's fall-to user   (per escalation reason)
 *   level 3  the department manager
 *   level 4  C-Level                     (the `c-level` pool — CEO *and* COO, so a pool, not a field)
 *
 * All of it ships empty. The server treats an unset value as "unrouted, refuse loudly" rather than as a
 * wildcard, so raising an escalation on an unconfigured reason is refused with a message pointing back at
 * this screen. `readiness` is computed server-side for exactly that reason: the banner here and the
 * refusal the agent sees must not be able to disagree.
 */
import { request } from './transport';

export interface PoolSeat {
  zohoUserId: string;
  displayName: string | null;
  /** 'CEO' | 'COO' | 'Team Lead' … What makes "Escalate to CEO" distinguishable from "to COO". */
  roleTitle: string | null;
  active: boolean;
  acceptsNew: boolean;
  maxOpen: number | null;
  sortOrder: number;
  lastAssignedAt: string | null;
  assignedCount: number;
}

export interface DepartmentRouting {
  department: string;
  /** ESCALATION LEVEL 3. */
  managerZohoUserId: string | null;
  managerName: string | null;
  /** Level-2 landing for a sideways hand-off INTO this department. */
  defaultAssigneeZohoUserId: string | null;
  ticketAssignmentStrategy: 'round_robin' | 'least_open' | 'manual';
  requireOnline: boolean;
  acceptsTickets: boolean;
  acceptsEscalations: boolean;
  slaHoursOverride: number | null;
  pool: PoolSeat[];
}

export interface EscalationReasonRouting {
  code: string;
  label: string;
  /** ESCALATION LEVEL 2 — the user this reason falls to. */
  defaultAssigneeZohoUserId: string | null;
  defaultPriority: string | null;
  active: boolean;
  sortOrder: number;
  routed: boolean;
}

export interface RoutingReadiness {
  /** Active reasons nobody can escalate on yet. */
  unroutedReasons: string[];
  /** Departments that accept escalations but have no level-3 manager. */
  departmentsMissingManager: string[];
  /** False = "Escalate to C-Level" is unavailable and the ladder stops at the manager. */
  cLevelConfigured: boolean;
}

export interface RoutingSnapshot {
  departments: DepartmentRouting[];
  escalationReasons: EscalationReasonRouting[];
  cLevel: PoolSeat[];
  readiness: RoutingReadiness;
  knownDepartments: string[];
}

export interface RoutingCandidate {
  zohoUserId: string;
  name: string;
  email: string | null;
  designation: string | null;
  department: string | null;
  status: string | null;
  /** HR thinks this person leads these departments — a suggestion for the manager picker. */
  leadOfDepartments: string[];
}

export async function getCommsRouting(): Promise<RoutingSnapshot> {
  return (await request('GET', '/comms/admin/routing')) as RoutingSnapshot;
}

/**
 * Pickable people, from the HR directory.
 *
 * Only employees who have a Zoho user id come back: that id IS the routing key, so offering anyone
 * without one would let you save a row that can never receive an escalation.
 */
export async function listRoutingCandidates(
  opts: { q?: string; department?: string; limit?: number } = {},
): Promise<{ candidates: RoutingCandidate[]; total: number; truncated: boolean }> {
  return (await request('GET', '/comms/admin/candidates', {
    query: {
      ...(opts.q ? { q: opts.q } : {}),
      ...(opts.department ? { department: opts.department } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
    },
  })) as { candidates: RoutingCandidate[]; total: number; truncated: boolean };
}

export interface DepartmentPatch {
  managerZohoUserId?: string | null;
  managerName?: string | null;
  defaultAssigneeZohoUserId?: string | null;
  ticketAssignmentStrategy?: 'round_robin' | 'least_open' | 'manual';
  requireOnline?: boolean;
  acceptsTickets?: boolean;
  acceptsEscalations?: boolean;
  slaHoursOverride?: number | null;
}

export async function patchDepartmentRouting(
  department: string,
  patch: DepartmentPatch,
): Promise<{ department: string }> {
  return (await request('PATCH', `/comms/admin/departments/${encodeURIComponent(department)}`, {
    body: patch,
  })) as { department: string };
}

export interface PoolSeatInput {
  zohoUserId: string;
  displayName?: string | null;
  roleTitle?: string | null;
  active?: boolean;
  acceptsNew?: boolean;
  maxOpen?: number | null;
  sortOrder?: number;
}

/** Add a seat, or revive one that was deactivated. Idempotent on (department, person). */
export async function upsertPoolSeat(
  department: string,
  input: PoolSeatInput,
): Promise<{ seat: PoolSeat }> {
  return (await request('POST', `/comms/admin/departments/${encodeURIComponent(department)}/pool`, {
    body: input,
  })) as { seat: PoolSeat };
}

export async function patchPoolSeat(
  department: string,
  zohoUserId: string,
  patch: Omit<PoolSeatInput, 'zohoUserId'>,
): Promise<{ seat: PoolSeat }> {
  const path = `/comms/admin/departments/${encodeURIComponent(department)}/pool/${encodeURIComponent(zohoUserId)}`;
  return (await request('PATCH', path, { body: patch })) as { seat: PoolSeat };
}

/**
 * Remove a seat outright.
 *
 * Different from deactivating: deactivating keeps the person's place in the round-robin rotation, which
 * is what you want for someone on leave. Either way, escalations already in flight are unaffected —
 * every hop snapshots its assignee.
 */
export async function removePoolSeat(department: string, zohoUserId: string): Promise<void> {
  const path = `/comms/admin/departments/${encodeURIComponent(department)}/pool/${encodeURIComponent(zohoUserId)}`;
  await request('DELETE', path);
}

export interface ReasonPatch {
  defaultAssigneeZohoUserId?: string | null;
  label?: string;
  defaultPriority?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export async function patchEscalationReason(
  code: string,
  patch: ReasonPatch,
): Promise<{ reason: EscalationReasonRouting }> {
  return (await request('PATCH', `/comms/admin/escalation-reasons/${encodeURIComponent(code)}`, {
    body: patch,
  })) as { reason: EscalationReasonRouting };
}
