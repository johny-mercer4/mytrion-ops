/**
 * Resolve which Mytrions a user may enter, from the declarative table in mytrions.config.ts.
 * Profile is the DEFAULT grant; role is optional; userName is an ADDITIVE override; admins bypass.
 * All matching is trimmed + case-insensitive. This is UI/routing only — NOT the security boundary
 * (the backend enforces real RBAC via x-api-key + department_access).
 */
import type { UserContext } from '../context/userContext';
import {
  ADMIN_PROFILES,
  ADMIN_ROLES,
  COMING_SOON_MYTRION_IDS,
  MYTRIONS,
  MYTRION_ORDER,
  type MytrionAccessRule,
  type MytrionId,
} from './mytrions.config';

const COMING_SOON = new Set<MytrionId>(COMING_SOON_MYTRION_IDS);

function isEnterable(id: MytrionId): boolean {
  return !COMING_SOON.has(id);
}

const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const inList = (value: string, list: string[]): boolean => Boolean(value) && list.some((x) => eq(x, value));
/** True if `value` CONTAINS any term (case-insensitive) — for substring profile grants. */
const containsAny = (value: string, list: string[] | undefined): boolean => {
  if (!value || !list || list.length === 0) return false;
  const v = value.trim().toLowerCase();
  return list.some((t) => t.trim() !== '' && v.includes(t.trim().toLowerCase()));
};

/** True if the user's profile/role marks them as an admin. */
export function isAdmin(ctx: UserContext): boolean {
  // Verified sessions carry the DB-resolved flag; trust it. Fall back to the static markers only
  // for the dev mock / legacy sessions with no server-resolved access.
  if (ctx.allDepartmentAccess !== undefined) return ctx.allDepartmentAccess;
  return inList(ctx.profile, ADMIN_PROFILES) || inList(ctx.role, ADMIN_ROLES);
}

/** Does this single rule grant the user access? */
export function ruleAllows(ctx: UserContext, rule: MytrionAccessRule, admin: boolean = isAdmin(ctx)): boolean {
  if (rule.adminBypass && admin) return true;
  if (inList(ctx.profile, rule.allowedProfiles)) return true; // default: by profile (exact)
  if (containsAny(ctx.profile, rule.profileContainsAny)) return true; // substring profile grant
  if (inList(ctx.role, rule.allowedRoles)) return true;
  if (inList(ctx.userName, rule.allowedUsernames)) return true; // additive: named-user override
  if (containsAny(ctx.userName, rule.usernameContainsAny)) return true; // substring username grant
  return false;
}

export interface AccessResult {
  accessible: MytrionId[];
  isAdmin: boolean;
  /** Auto-route landing target for a verified session (else null → picker / single-accessible). */
  homeMytrion: MytrionId | null;
}

/**
 * The Mytrions this user may enter, in display order. Verified sessions use the server-resolved
 * list (DB-authoritative, kept in display order); the static table is the dev-mock/legacy fallback.
 */
/**
 * A team lead reaches HR for ONE reason: their team's attendance.
 *
 * They have no `hr` grant, so the server never lists HR among their Mytrions — but attendance is the
 * one HR surface whose routes admit them (scoped to their own reportees). Rather than invent a second
 * kind of Mytrion access, HR is added to their list and every HR tab except Attendance is hidden.
 *
 * The hiding is a COURTESY, not the boundary: `hrAttendance.routes.ts` re-derives the team from
 * reporting lines per request, and the employee-directory / departments / org routes still require real
 * `hr` access, so they 403 a team lead whatever the client renders.
 */
export function hasFullHrAccess(ctx: UserContext): boolean {
  if (isAdmin(ctx)) return true;
  const granted = ctx.accessibleMytrions;
  return granted ? granted.includes('hr') : false;
}

/** True when HR is open to this person for attendance and nothing else. */
export function isHrAttendanceOnly(ctx: UserContext): boolean {
  return ctx.leadsTeam === true && !hasFullHrAccess(ctx);
}

export function resolveAccessibleMytrions(ctx: UserContext): AccessResult {
  const admin = isAdmin(ctx);
  if (ctx.accessibleMytrions) {
    const granted = new Set(ctx.accessibleMytrions);
    // Team leads get the HR door for Attendance. See `isHrAttendanceOnly`.
    if (ctx.leadsTeam === true) granted.add('hr');
    const accessible = MYTRION_ORDER.filter((id) => granted.has(id) && isEnterable(id));
    const home =
      ctx.homeMytrion && accessible.includes(ctx.homeMytrion) ? ctx.homeMytrion : null;
    return { accessible, isAdmin: admin, homeMytrion: home };
  }
  const accessible = MYTRION_ORDER.filter(
    (id) => isEnterable(id) && ruleAllows(ctx, MYTRIONS[id], admin),
  );
  return { accessible, isAdmin: admin, homeMytrion: null };
}

/** Single-Mytrion gate used by the route guard. */
export function canAccess(ctx: UserContext, id: MytrionId): boolean {
  if (!isEnterable(id)) return false;
  if (ctx.accessibleMytrions) return ctx.accessibleMytrions.includes(id);
  const rule = MYTRIONS[id];
  return rule ? ruleAllows(ctx, rule) : false;
}

/**
 * Write capability for a Mytrion (Billing first). Admins / all-dept always write. Mode `read`
 * blocks map/unmap/match UI; backend still enforces on POST.
 */
export function canWriteMytrion(ctx: UserContext, id: MytrionId): boolean {
  if (isAdmin(ctx)) return true;
  if (!canAccess(ctx, id)) return false;
  return ctx.mytrionAccessModes?.[id] !== 'read';
}

/**
 * May this user see this tab?
 *
 * UI GATING ONLY — see the module header. The backend enforces at Mytrion + read/full and nothing
 * finer, so hiding a tab removes the door, not the lock. A user whose set hides Billing → Ledger can
 * still call the ledger endpoints with their session token, because those routes ask "do you have
 * the `billing` department?" and they do. Do not sell tab permissions as data security; they are
 * workspace curation.
 *
 * ABSENT = UNRESTRICTED. A Mytrion with no entry in `mytrionTabGrants` shows every tab, including
 * tabs added after the grant was written. Only an explicitly scoped Mytrion filters — which is what
 * keeps a newly shipped tab from going invisible for everyone who has no scoped set.
 */
export function canSeeTab(ctx: UserContext, id: MytrionId, tabKey: string): boolean {
  if (isAdmin(ctx)) return true;
  const grant = ctx.mytrionTabGrants?.[id];
  return grant ? grant.includes(tabKey) : true;
}

/**
 * The first tab this user may actually open, skipping hidden AND `soon` entries.
 *
 * `preferred` is honoured when it is both visible and real — that is the deep-link case, and the
 * reason this returns the fallback rather than throwing: a stale bookmark should land somewhere
 * sensible, not on an error.
 */
export function firstVisibleTab<T extends { key: string; soon?: boolean | undefined }>(
  ctx: UserContext,
  id: MytrionId,
  tabs: readonly T[],
  preferred?: string,
): T | undefined {
  const visible = tabs.filter((t) => t.soon !== true && canSeeTab(ctx, id, t.key));
  if (preferred !== undefined) {
    const match = visible.find((t) => t.key === preferred);
    if (match) return match;
  }
  return visible[0];
}
