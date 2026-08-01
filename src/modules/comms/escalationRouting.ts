import { ESCALATION_LEVEL_LABELS, type EscalationLevel } from '../../db/schema/index.js';
import { ValidationError } from '../../lib/errors.js';
import { commsCatalogRepo } from '../../repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../repos/commsDepartmentRepo.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import type { MytrionTicketType } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

/**
 * WHO an escalation goes to at each level — resolved from admin config at every hop, never hardcoded.
 *
 *   level 1  requester          the person who raised it (not a hop; they are `requester_zoho_user_id`)
 *   level 2  agent              `mytrion_ticket_types.default_assignee_zoho_user_id` for the REASON
 *   level 3  department manager `mytrion_department_config.manager_zoho_user_id`
 *   level 4  C-Level            an explicit pick from the `c-level` pool (CEO *and* COO, so not one column)
 *
 * Every one of those is NULL out of the box, by design. A NULL is "unrouted, refuse loudly" and never a
 * wildcard: `hr_employees.zoho_user_id` is nullable and heuristic, so a fallback that guessed would send
 * a real escalation to the wrong person silently. HR is only ever a source of CANDIDATES for the admin
 * picker and of display names; the config row is what routes.
 *
 * The resolution result is SNAPSHOTTED onto the hop by the caller, so editing config later cannot
 * reroute an escalation already in flight.
 */

/** The `c-level` department slug — a KNOWN_DEPARTMENTS value, and the level-4 pool. */
export const C_LEVEL_DEPARTMENT = 'c-level';

export interface ResolvedAssignee {
  zohoUserId: string;
  name: string;
  department: string | null;
  level: EscalationLevel;
  levelLabel: string;
}

/** Why a level could not be routed. Recorded as `skip_reason` on the hop, so the gap is visible. */
export type RoutingSkipReason = 'no_reason_default' | 'no_manager' | 'inactive' | 'is_requester';

/**
 * A display name for a Zoho user id, from the HR directory.
 *
 * Best-effort by design: `hr_employees.zoho_user_id` is a heuristic link, so a miss is normal and must
 * not block routing. Falling back to the id keeps the chain renderable — an id in the UI is ugly, an
 * exception is a broken escalation.
 */
export async function resolveWorkerName(
  ctx: TenantContext,
  zohoUserId: string,
  hint?: string | null,
): Promise<string> {
  if (hint && hint.trim().length > 0) return hint.trim();
  const row = await hrEmployeeRepo.findByZohoUserId(ctx, zohoUserId).catch(() => undefined);
  if (!row) return zohoUserId;
  const full = [row.firstName, row.lastName].filter((p) => p && p.trim().length > 0).join(' ').trim();
  return full.length > 0 ? full : zohoUserId;
}

export interface ReasonRoute {
  reason: MytrionTicketType;
  /** NULL when the reason has no fall-to user configured yet. */
  assigneeZohoUserId: string | null;
}

/**
 * Load an escalation reason and its level-2 fall-to user.
 *
 * Refuses an unknown, inactive or wrong-kind code here rather than at insert time, so the agent gets a
 * message they can act on instead of a constraint error.
 */
export async function resolveReason(ctx: TenantContext, reasonCode: string): Promise<ReasonRoute> {
  const reason = await commsCatalogRepo.byCode(ctx, reasonCode);
  if (!reason || reason.kind !== 'escalation_reason') {
    throw new ValidationError(`Unknown escalation reason '${reasonCode}'.`);
  }
  if (!reason.active) {
    throw new ValidationError(`Escalation reason '${reason.label}' is no longer available.`);
  }
  const assignee = reason.defaultAssigneeZohoUserId;
  return {
    reason,
    assigneeZohoUserId: assignee && assignee.trim().length > 0 ? assignee.trim() : null,
  };
}

/**
 * The department a level-2 assignee belongs to, for the hop's `department` column.
 *
 * Read from the POOL rather than from HR: the pool is the operational statement of who works a queue,
 * and it is also the only source that can place the same person in two departments. A person routed by a
 * reason default need not be on any pool — hence null, which is fine: the hop still records the assignee,
 * and level 3 then resolves from the requester's own department instead.
 */
export async function departmentOfWorker(
  ctx: TenantContext,
  zohoUserId: string,
): Promise<string | null> {
  const pool = await commsDepartmentRepo.listPool(ctx, { activeOnly: true });
  const seat = pool.find((p) => p.zohoUserId === zohoUserId && p.department !== C_LEVEL_DEPARTMENT);
  return seat?.department ?? null;
}

export interface ManagerRoute {
  zohoUserId: string | null;
  name: string | null;
  skipReason?: RoutingSkipReason;
}

export interface DepartmentAgentRoute {
  zohoUserId: string;
  name: string;
  department: string;
  /** How the department's agent was chosen, recorded on the hop so the routing is explainable. */
  via: 'department_default' | 'pool';
}

/**
 * LEVEL 2 for a department — the agent an escalation OPENED AGAINST that department lands on.
 *
 * The department is chosen when the request is opened, so this is the primary level-2 resolution: an
 * escalation aimed at Billing goes to Billing's agent, not to whoever a reason happens to name. Precedence:
 *   1. `default_assignee_zoho_user_id` — the department's explicitly nominated first responder.
 *   2. the least-recently-assigned eligible pool member, so a department that staffs a rota instead of
 *      nominating one person still routes, and the load spreads.
 *
 * The MANAGER is deliberately not a fallback here. Level 3 exists precisely so an escalation reaches the
 * head only after the agent level has had it; falling straight through to the manager would collapse two
 * rungs into one and there would be nothing left to escalate to.
 *
 * Returns null when the department has neither — the caller decides whether that is a refusal (opening a
 * request against it) or a reason to try something else.
 */
export async function resolveDepartmentAgent(
  ctx: TenantContext,
  department: string,
): Promise<DepartmentAgentRoute | null> {
  const config = await commsDepartmentRepo.get(ctx, department);
  if (!config) return null;

  const nominated = config.defaultAssigneeZohoUserId?.trim();
  if (nominated) {
    return {
      zohoUserId: nominated,
      name: await resolveWorkerName(ctx, nominated, null),
      department,
      via: 'department_default',
    };
  }

  const pool = await commsDepartmentRepo.listPool(ctx, {
    departments: [department],
    activeOnly: true,
  });
  // `listPool` orders by (department, sortOrder, zohoUserId); pick the least-recently-assigned among those
  // still accepting work, which is the same fairness rule ticket round-robin uses. NULL means never
  // assigned, so a newly added member goes first — they are owed work.
  const eligible = pool
    .filter((p) => p.acceptsNew)
    .sort((a, b) => {
      const at = a.lastAssignedAt?.getTime() ?? 0;
      const bt = b.lastAssignedAt?.getTime() ?? 0;
      return at - bt;
    });
  const seat = eligible[0];
  if (!seat) return null;

  return {
    zohoUserId: seat.zohoUserId,
    name: seat.displayName ?? (await resolveWorkerName(ctx, seat.zohoUserId, null)),
    department,
    via: 'pool',
  };
}

/**
 * LEVEL 3 — the department manager an escalation rises to.
 *
 * `hr_departments.lead_employee_id` is deliberately NOT consulted as a fallback: it resolves through
 * `hr_employees.zoho_user_id`, which is nullable and heuristic, so a silent fallback could route a real
 * escalation to whoever happened to be linked. HR suggests a value in the admin picker; this decides.
 */
export async function resolveDepartmentManager(
  ctx: TenantContext,
  department: string | null,
): Promise<ManagerRoute> {
  if (!department) return { zohoUserId: null, name: null, skipReason: 'no_manager' };
  const config = await commsDepartmentRepo.get(ctx, department);
  const id = config?.managerZohoUserId?.trim();
  if (!id) return { zohoUserId: null, name: null, skipReason: 'no_manager' };
  return { zohoUserId: id, name: config?.managerName ?? null };
}

/**
 * LEVEL 4 — validate an explicit C-Level pick against the pool.
 *
 * Explicit rather than resolved, because level 4 is CEO *and* COO and which one to involve is a human
 * decision — that is exactly why 0091 dropped the single `c_level_zoho_user_id` column. The pick is
 * validated against the pool so "escalate to C-Level" cannot become "escalate to anyone I name".
 */
export async function resolveCLevel(
  ctx: TenantContext,
  zohoUserId: string,
): Promise<ResolvedAssignee> {
  const pool = await commsDepartmentRepo.listPool(ctx, {
    departments: [C_LEVEL_DEPARTMENT],
    activeOnly: true,
  });
  if (pool.length === 0) {
    throw new ValidationError(
      'No C-Level members are configured yet. Add the CEO and COO to the c-level pool in Mytrion Admin.',
    );
  }
  const seat = pool.find((p) => p.zohoUserId === zohoUserId);
  if (!seat) {
    const options = pool
      .map((p) => `${p.roleTitle ?? 'C-Level'}${p.displayName ? ` (${p.displayName})` : ''}`)
      .join(', ');
    throw new ValidationError(
      `That person is not in the C-Level pool. Available: ${options}.`,
    );
  }
  return {
    zohoUserId: seat.zohoUserId,
    name: seat.displayName ?? seat.zohoUserId,
    department: C_LEVEL_DEPARTMENT,
    level: 4,
    levelLabel: ESCALATION_LEVEL_LABELS[4],
  };
}

export interface HandOffTarget {
  zohoUserId: string;
  name: string;
  department: string;
}

/**
 * A SIDEWAYS hand-off target: another department, re-entered at its agent level (level 2 again).
 *
 * Precedence when no explicit person is named: the department's `default_assignee_zoho_user_id`, then its
 * manager. Falling back to the manager is deliberate — a department with no default assignee still has
 * someone accountable, and refusing outright would make a correctly-configured-enough department
 * unreachable. When a person IS named they must hold a seat in that department's pool, be its configured
 * default, or be its manager; otherwise "hand off to Billing" becomes "assign to anyone I name".
 */
export async function resolveHandOffTarget(
  ctx: TenantContext,
  department: string,
  explicitZohoUserId?: string | null,
): Promise<HandOffTarget> {
  const config = await commsDepartmentRepo.get(ctx, department);
  if (!config) {
    throw new ValidationError(`Department '${department}' has no routing configuration yet.`);
  }
  if (!config.acceptsEscalations) {
    throw new ValidationError(`The ${department} department is not accepting escalations.`);
  }

  if (explicitZohoUserId && explicitZohoUserId.trim().length > 0) {
    const wanted = explicitZohoUserId.trim();
    const pool = await commsDepartmentRepo.listPool(ctx, {
      departments: [department],
      activeOnly: true,
    });
    const seat = pool.find((p) => p.zohoUserId === wanted);
    const isConfigured =
      config.defaultAssigneeZohoUserId === wanted || config.managerZohoUserId === wanted;
    if (!seat && !isConfigured) {
      throw new ValidationError(
        `That person is not on the ${department} escalation roster. Add them in Mytrion Admin first.`,
      );
    }
    // Name hint precedence: the pool seat's own label, then the config's manager snapshot when the named
    // person IS that manager. Both are already in hand, so reaching for HR here would be a round trip to
    // re-derive a name the caller already loaded.
    const hint =
      seat?.displayName ?? (config.managerZohoUserId === wanted ? config.managerName : null);
    return {
      zohoUserId: wanted,
      name: await resolveWorkerName(ctx, wanted, hint),
      department,
    };
  }

  const fallback = config.defaultAssigneeZohoUserId?.trim() || config.managerZohoUserId?.trim();
  if (!fallback) {
    throw new ValidationError(
      `The ${department} department has no escalation assignee configured. Set one in Mytrion Admin.`,
    );
  }
  return {
    zohoUserId: fallback,
    name: await resolveWorkerName(
      ctx,
      fallback,
      config.managerZohoUserId === fallback ? config.managerName : null,
    ),
    department,
  };
}
