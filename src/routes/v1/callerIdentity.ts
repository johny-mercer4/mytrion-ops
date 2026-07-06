/**
 * Caller identity → TenantContext. The single place that decides what authority an inbound
 * request runs with. Two trusted-frontend caller shapes share the API_KEY:
 *
 *   Worker (Zoho widget / Mytrion app): zoho_user_id / user_name / profile / role
 *     + department_scope. The frontend is trusted to assert scope ("done from my end"),
 *     including allDepartments for manager-tier users.
 *
 *   Customer (Telegram bot / mini-app): carrier_id or application_id (company id) + chat_id
 *     + company_name. Customer input ultimately originates from END USERS, so with
 *     FF_CUSTOMER_SCOPE_STRICT the context is locked down server-side: audience 'customer'
 *     (deny-by-default for tools/agents), viewer role, NO scopes, departments = the company
 *     tag only — client-supplied department_scope / allDepartments / profile / role /
 *     user_name are ignored. Customer markers win when both shapes appear.
 *
 * With the flag off, customer requests keep the legacy (worker-style) merge but log a loud
 * warning listing the fields strict mode will ignore, so the Telegram shim can migrate first.
 */
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import {
  deriveWorkerDepartments,
  isBypassUser,
  normalizeDepartments,
  resolveAllDepartmentAccess,
} from '../../lib/department.js';
import { RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveActAsTarget } from '../../modules/auth/actAsDirectory.js';
import { workerRoleFor } from '../../modules/auth/workerRole.js';
import { scopesForRole } from '../../modules/auth/permissions.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const stringOrList = z.union([z.string(), z.array(z.string().max(120)).max(50)]);
const scopeSchema = z.union([z.string(), z.array(z.string().max(60)).max(50)]);

/** Identity + RBAC-scope fields shared by every caller-facing route (chat, agent, tasks). */
export const callerIdentitySchema = z.object({
  // --- Worker (Octane) identity — from the Zoho widget / Mytrion app ---
  zoho_user_id: z.string().min(1).max(120).optional(),
  user_name: z.string().min(1).max(200).optional(),
  // Caller's Zoho role + profile. An "Administrator" profile bypasses ALL RBAC (RAG + tools).
  role: stringOrList.optional(),
  profile: stringOrList.optional(),
  // --- Customer identity — from the Telegram bot / mini-app. The company id isolates their data. ---
  carrier_id: z.union([z.string().max(60), z.number()]).optional(),
  application_id: z.union([z.string().max(60), z.number()]).optional(),
  company_name: z.string().min(1).max(200).optional(),
  chat_id: z.union([z.string().max(60), z.number()]).optional(),
  // --- RBAC scope: the caller's department(s). Accepts a single key or a list. ---
  department_scope: scopeSchema.optional(),
  // Compatibility aliases (same effect as department_scope).
  departmentAccess: z.array(z.string().min(1).max(60)).max(50).optional(),
  allDepartments: z.boolean().optional(),
});

export type CallerIdentityBody = z.infer<typeof callerIdentitySchema>;

export function toArray(v?: string | string[]): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Stable conversation-owner id for a Zoho caller (namespaced to avoid collisions). */
export function identityFrom(zohoUserId?: string, userName?: string): string | undefined {
  const id = zohoUserId?.trim();
  if (id) return `zoho:${id}`;
  const name = userName?.trim();
  if (name) return `zoho-name:${name}`;
  return undefined;
}

/** Owner-scoped context (userId = `zoho:<id>`) so list/create attach to that user's chats. */
export function ownerCtx(ctx: TenantContext, zohoUserId?: string, userName?: string): TenantContext {
  const userId = identityFrom(zohoUserId, userName);
  return userId ? { ...ctx, userId } : ctx;
}

/** A customer's company identifier(s) — these become their only department tags. */
export function companyTags(body: CallerIdentityBody): string[] {
  return [body.carrier_id, body.application_id]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
}

/** True when the request carries customer markers (Telegram bot / mini-app shape). */
export function hasCustomerMarkers(body: CallerIdentityBody): boolean {
  return companyTags(body).length > 0 || body.chat_id != null;
}

/** Scope/identity fields a customer caller must never control. */
function ignoredCustomerFields(body: CallerIdentityBody): string[] {
  const fields: Array<[string, unknown]> = [
    ['department_scope', body.department_scope],
    ['departmentAccess', body.departmentAccess],
    ['allDepartments', body.allDepartments],
    ['profile', body.profile],
    ['role', body.role],
    ['user_name', body.user_name],
    ['zoho_user_id', body.zoho_user_id],
  ];
  return fields.filter(([, v]) => v !== undefined).map(([k]) => k);
}

/**
 * Locked-down customer context: audience 'customer' (deny-by-default), viewer role, no scopes,
 * departments = company tag(s) only. Nothing here is derived from client-asserted scope fields.
 */
function customerContext(request: FastifyRequest, body: CallerIdentityBody): TenantContext {
  const base = requireContext(request);
  const tags = normalizeDepartments(companyTags(body));
  const owner =
    body.chat_id != null ? `customer:tg:${String(body.chat_id).trim()}`
    : tags[0] ? `customer:${tags[0]}`
    : base.userId;
  const ctx: TenantContext = {
    tenantId: base.tenantId,
    userId: owner,
    audience: 'customer',
    role: 'viewer',
    scopes: [],
    departments: tags,
    allDepartmentAccess: false,
    requestId: base.requestId,
  };
  const displayName = body.company_name?.trim();
  if (displayName) ctx.userName = displayName;
  return ctx;
}

/** Worker context — the trusted-frontend merge (previous chatContext behavior, verbatim). */
function workerContext(request: FastifyRequest, body: CallerIdentityBody): TenantContext {
  const workerName = body.user_name?.trim();
  const departmentAccess = [
    ...toArray(body.department_scope),
    ...(body.departmentAccess ?? []),
    ...companyTags(body),
  ];
  // See-everything bypass for RAG + tools: explicit allDepartments, an admin profile/role marker,
  // or an ADMIN_USERS/BYPASS_USERS match on the worker user_name.
  const allDepartments = resolveAllDepartmentAccess({
    allDepartments: body.allDepartments,
    profile: body.profile,
    role: body.role,
    userName: workerName,
  });
  const ctx = withDepartmentAccess(requireContext(request), request, { departmentAccess, allDepartments });
  // Conversation owner: worker by zoho id / name; customer by chat_id (legacy shape).
  const merged = ownerCtx(
    ctx,
    body.zoho_user_id,
    workerName ?? (body.chat_id != null ? `tg:${body.chat_id}` : undefined),
  );
  const profiles = toArray(body.profile);
  const callerRole = toArray(body.role).join(', ');
  if (profiles.length > 0) merged.profiles = profiles;
  if (callerRole) merged.callerRole = callerRole;
  const displayName = workerName ?? body.company_name?.trim();
  if (displayName) merged.userName = displayName;
  // Hard RBAC bypass — only for the trusted BYPASS_USERS allowlist (by worker user_name).
  if (isBypassUser(workerName)) merged.bypassRbac = true;
  return merged;
}

/**
 * Build the per-request security context. Customer markers win over worker fields; strict mode
 * locks customers down, legacy mode preserves today's behavior but warns about what will change.
 */
/** Department VIEW from the request body (which Mytrion the caller is looking at). */
function departmentView(body: CallerIdentityBody): string[] {
  return normalizeDepartments([...toArray(body.department_scope), ...(body.departmentAccess ?? [])]);
}

/**
 * The admin "act as agent" TARGET id from the x-act-as-zoho-user-id header. This is the ONLY
 * act-as input the client controls — the target's real name/profile/role are looked up in the
 * CRM directory (actAsDirectory). Legacy x-act-as-user-name/-profile/-role headers are ignored.
 */
function readActAsId(request: FastifyRequest): string | null {
  const h = request.headers;
  const one = (v: string | string[] | undefined): string | undefined => {
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : undefined;
  };
  const zohoUserId = one(h['x-act-as-zoho-user-id']);
  if (!zohoUserId) return null;
  if (h['x-act-as-profile'] || h['x-act-as-role'] || h['x-act-as-user-name']) {
    request.log.info(
      'act-as identity headers ignored; the target identity is verified from the CRM directory',
    );
  }
  return zohoUserId;
}

/**
 * Impersonated context for a verified admin acting AS a CRM agent. The target's authority is
 * derived from their VERIFIED CRM profile/role — the request runs with the target's role and
 * scopes (an admin acting as a sales rep is a worker for the duration), and the real admin's
 * userId is recorded for audit attribution. Fail-closed on unknown targets.
 */
async function actAsContext(
  request: FastifyRequest,
  base: TenantContext,
  body: CallerIdentityBody,
  targetId: string,
): Promise<TenantContext> {
  const target = await resolveActAsTarget(targetId);
  if (!target) {
    await auditFromContext(base, {
      action: 'auth.act_as',
      status: 'denied',
      detail: { target: targetId, reason: 'unknown or inactive CRM user' },
    });
    throw new RBACError(`Unknown act-as target '${targetId}'`);
  }
  const role = workerRoleFor({
    userName: target.name,
    profile: target.profile,
    zohoRole: target.role,
  });
  const targetAllAccess = role === 'admin';
  const ctx: TenantContext = {
    ...base,
    userId: `zoho:${target.zohoUserId}`,
    role,
    scopes: scopesForRole(role),
    allDepartmentAccess: targetAllAccess,
    departments: targetAllAccess ? [] : departmentView(body),
    profiles: target.profile ? [target.profile] : [],
    impersonatorUserId: base.userId,
  };
  // Owner-scoped tools resolve the acting agent by userId (zoho:<id>) and userName — set both.
  if (target.name) ctx.userName = target.name;
  else delete ctx.userName;
  if (target.role) ctx.callerRole = target.role;
  else delete ctx.callerRole;
  await auditFromContext(ctx, {
    action: 'auth.act_as',
    status: 'ok',
    detail: { target: target.zohoUserId, impersonator: base.userId },
  });
  return ctx;
}

/** Verified non-admin worker departments: the body view, bounded by the profile-derived set. */
function verifiedWorkerDepartments(base: TenantContext, body: CallerIdentityBody): string[] {
  const view = departmentView(body);
  if (!env.FF_WORKER_DEPT_STRICT) return view;
  const derived = deriveWorkerDepartments(base.profiles, base.callerRole ?? null);
  return view.length > 0 ? view.filter((d) => derived.includes(d)) : derived;
}

export async function buildCallerContext(
  request: FastifyRequest,
  body: CallerIdentityBody,
): Promise<TenantContext> {
  // Verified worker session (Zoho OAuth): identity is authoritative — ignore ALL client-supplied
  // identity fields. Only the department VIEW (which Mytrion) is taken from the request, and only
  // for non-admin workers (admins already see everything). Owner-scoping uses the verified userId.
  const base = requireContext(request);
  if (base.sessionVerified) {
    // Admin "act as agent": an admin may impersonate a target agent (from CRM) so the whole request
    // runs AS that agent — owner-scoped data becomes the target's. Gated to admins; audited.
    const actAsId = base.allDepartmentAccess ? readActAsId(request) : null;
    if (actAsId) return actAsContext(request, base, body, actAsId);
    if (base.allDepartmentAccess) return base;
    const departments = verifiedWorkerDepartments(base, body);
    return departments.length > 0 ? { ...base, departments } : base;
  }
  if (!hasCustomerMarkers(body)) return workerContext(request, body);
  const ignored = ignoredCustomerFields(body);
  if (env.FF_CUSTOMER_SCOPE_STRICT) {
    if (ignored.length > 0) {
      request.log.warn(
        { ignored },
        'customer caller supplied worker/scope fields; ignored under FF_CUSTOMER_SCOPE_STRICT',
      );
    }
    return customerContext(request, body);
  }
  if (ignored.length > 0) {
    request.log.warn(
      { ignored },
      'SECURITY: customer caller supplied worker/scope fields; honored for now but these will be ' +
        'IGNORED once FF_CUSTOMER_SCOPE_STRICT=1 — update the Telegram shim to stop sending them',
    );
  }
  return workerContext(request, body);
}
