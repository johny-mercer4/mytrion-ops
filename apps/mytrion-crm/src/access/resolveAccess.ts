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
export function resolveAccessibleMytrions(ctx: UserContext): AccessResult {
  const admin = isAdmin(ctx);
  if (ctx.accessibleMytrions) {
    const granted = new Set(ctx.accessibleMytrions);
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
