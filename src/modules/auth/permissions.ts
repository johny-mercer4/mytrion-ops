import { WILDCARD_SCOPE } from '../../config/constants.js';
import type { Audience, Role } from '../../types/tenantContext.js';

/**
 * The single source of truth for RBAC. Scopes are derived from role here and
 * NOWHERE else — never read from a JWT or client input — so a tampered token
 * cannot escalate privileges. The dispatcher re-checks these on every tool call.
 */
export const rolePermissions: Record<Role, { scopes: string[]; audiences: Audience[] }> = {
  admin: { scopes: ['*'], audiences: ['internal', 'partner'] },
  // Signed-in Octane worker without an admin profile: READ scopes only (least privilege —
  // no telegram:*), so non-read tools stay admin-gated. Department access still bounds reads.
  worker: {
    scopes: ['zoho_crm:read', 'servercrm:read', 'zoho_desk:read', 'zoho_people:read'],
    audiences: ['internal'],
  },
  ops: {
    scopes: ['zoho_crm:read', 'octane_card:read', 'octane_tx:read', 'partner:read'],
    audiences: ['internal'],
  },
  finance: {
    scopes: ['octane_card:read', 'octane_tx:read', 'zoho_crm:read'],
    audiences: ['internal'],
  },
  support: {
    scopes: ['zoho_crm:read', 'octane_card:read', 'partner:read'],
    audiences: ['internal'],
  },
  viewer: { scopes: ['zoho_crm:read'], audiences: ['internal'] },
  driver: { scopes: ['partner:self:read'], audiences: ['partner'] },
  fleet_manager: { scopes: ['partner:fleet:read'], audiences: ['partner'] },
};

export function scopesForRole(role: Role): string[] {
  return [...rolePermissions[role].scopes];
}

export function audiencesForRole(role: Role): Audience[] {
  return [...rolePermissions[role].audiences];
}

export function roleAllowsAudience(role: Role, audience: Audience): boolean {
  return rolePermissions[role].audiences.includes(audience);
}

/** Does a single granted scope satisfy a required one? Supports '*' and 'prefix:*'. */
export function scopeSatisfies(granted: string, required: string): boolean {
  if (granted === WILDCARD_SCOPE) return true;
  if (granted === required) return true;
  if (granted.endsWith(':*')) {
    return required.startsWith(granted.slice(0, -1));
  }
  return false;
}

export function hasScope(granted: string[], required: string): boolean {
  return granted.some((g) => scopeSatisfies(g, required));
}

export function hasAllScopes(granted: string[], required: string[]): boolean {
  return required.every((r) => hasScope(granted, r));
}
