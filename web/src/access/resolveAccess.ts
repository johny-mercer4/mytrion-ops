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
  MYTRIONS,
  MYTRION_ORDER,
  type MytrionAccessRule,
  type MytrionId,
} from './mytrions.config';

const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const inList = (value: string, list: string[]): boolean => Boolean(value) && list.some((x) => eq(x, value));

/** True if the user's profile/role marks them as an admin. */
export function isAdmin(ctx: UserContext): boolean {
  return inList(ctx.profile, ADMIN_PROFILES) || inList(ctx.role, ADMIN_ROLES);
}

/** Does this single rule grant the user access? */
export function ruleAllows(ctx: UserContext, rule: MytrionAccessRule, admin: boolean = isAdmin(ctx)): boolean {
  if (rule.adminBypass && admin) return true;
  if (inList(ctx.profile, rule.allowedProfiles)) return true; // default: by profile
  if (inList(ctx.role, rule.allowedRoles)) return true;
  if (inList(ctx.userName, rule.allowedUsernames)) return true; // additive: named-user override
  return false;
}

export interface AccessResult {
  accessible: MytrionId[];
  isAdmin: boolean;
}

/** The Mytrions this user may enter, in display order. */
export function resolveAccessibleMytrions(ctx: UserContext): AccessResult {
  const admin = isAdmin(ctx);
  const accessible = MYTRION_ORDER.filter((id) => ruleAllows(ctx, MYTRIONS[id], admin));
  return { accessible, isAdmin: admin };
}

/** Single-Mytrion gate used by the route guard. */
export function canAccess(ctx: UserContext, id: MytrionId): boolean {
  const rule = MYTRIONS[id];
  return rule ? ruleAllows(ctx, rule) : false;
}
