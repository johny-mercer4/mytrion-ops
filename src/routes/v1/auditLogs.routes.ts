/**
 * Admin log surfaces — the Audit Log and the Automation Logs tabs read from here.
 *
 * Split out of admin.routes.ts rather than added to it: between the two feeds, their filter sets
 * and their facet endpoints this is ~200 lines, and admin.routes.ts was already past half the
 * 600-line cap.
 *
 * Guard note: `sessionOrApiKey` + an explicit role check, matching the gate the audit route has
 * always used — admin-profile workers and the trusted widget key pass; 'worker' and customer
 * sessions are denied.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AUDIENCES } from '../../types/tenantContext.js';
import { AppError, RBACError } from '../../lib/errors.js';
import { isMissingColumn, isMissingTable } from '../../repos/util.js';
import { MYTRION_IDS, type MytrionId } from '../../lib/mytrions.js';
import { mytrionAccessService } from '../../modules/access/mytrionAccessService.js';
import { auditSessionEvent } from '../../modules/audit/sessionEvents.js';
import { AUTOMATION_ORIGIN_SOURCES } from '../../db/schema/index.js';
import { auditRepo, type AuditFilter } from '../../repos/auditRepo.js';
import { automationLogRepo, type AutomationLogFilter } from '../../repos/automationLogRepo.js';
import { requireContext } from './helpers.js';

/**
 * The three events that mean "someone signed in". They share no action prefix, which is why the
 * Logins view selects them by exact name: the `auth.` prefix that used to stand in for it also
 * matched `auth.act_as` (per-request impersonation) and never matched `mini_app.auth.login` at all,
 * so the view showed ~9k rows of noise and zero carrier logins.
 */
export const LOGIN_ACTIONS = ['auth.login', 'auth.zoho.login', 'mini_app.auth.login'] as const;

/** Comma-separated list → trimmed string[] (query strings can't carry arrays cleanly). */
const csv = z
  .string()
  .max(600)
  .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean));

const isoDate = z.coerce.date();

const auditQuerySchema = z.object({
  /** Action PREFIX ('auth.' matches every auth event; exact names work too). */
  action: z.string().max(120).optional(),
  /** Exact action names, comma-separated — takes precedence over `action` when both are sent. */
  actions: csv.optional(),
  audience: z.enum(AUDIENCES).optional(),
  status: z.enum(['ok', 'denied', 'error']).optional(),
  user_id: z.string().max(200).optional(),
  user_name: z.string().max(200).optional(),
  profile: z.string().max(200).optional(),
  role: z.string().max(100).optional(),
  caller_role: z.string().max(200).optional(),
  resource_type: z.string().max(100).optional(),
  resource_id: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const automationQuerySchema = z.object({
  automation_type: z.string().max(200).optional(),
  agent_name: z.string().max(200).optional(),
  origin_source: z.enum(AUTOMATION_ORIGIN_SOURCES).optional(),
  search: z.string().max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function requireAdmin(request: FastifyRequest): ReturnType<typeof requireContext> {
  const ctx = requireContext(request);
  if (ctx.role !== 'admin' && !ctx.bypassRbac) {
    throw new RBACError('Audit log requires admin access');
  }
  return ctx;
}

/**
 * Turn "code is running ahead of its migration" into an answer instead of a bare 500.
 *
 * `origin_source` is new in 0118, and the realistic way to meet this is an environment one
 * migration behind — a local backend pointed at a database that has not had 0118 applied. Left raw
 * it surfaces as `Internal server error` on a screen that can explain the problem precisely, and
 * sends whoever hit it to the logs to find a one-line answer. `isMissingColumn` is scoped per table
 * because Postgres does not name the table in an undefined-column message.
 */
async function withAutomationReadiness<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingColumn(error, 'automation_logs') || isMissingTable(error, 'automation_logs')) {
      throw new AppError(
        'Automation Logs migration 0118 is not applied to this database (automation_logs.origin_source is missing).',
        { statusCode: 503, code: 'AUTOMATION_LOGS_NOT_READY', expose: true, cause: error },
      );
    }
    throw error;
  }
}

function toAuditFilter(q: z.infer<typeof auditQuerySchema>): AuditFilter {
  return {
    ...(q.action ? { action: q.action } : {}),
    ...(q.actions && q.actions.length > 0 ? { actions: q.actions } : {}),
    ...(q.audience ? { audience: q.audience } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.user_id ? { userId: q.user_id } : {}),
    ...(q.user_name ? { userName: q.user_name } : {}),
    ...(q.profile ? { profile: q.profile } : {}),
    ...(q.role ? { role: q.role } : {}),
    ...(q.caller_role ? { callerRole: q.caller_role } : {}),
    ...(q.resource_type ? { resourceType: q.resource_type } : {}),
    ...(q.resource_id ? { resourceId: q.resource_id } : {}),
    ...(q.search ? { search: q.search } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
    ...(q.limit !== undefined ? { limit: q.limit } : {}),
    ...(q.offset !== undefined ? { offset: q.offset } : {}),
  };
}

function toAutomationFilter(q: z.infer<typeof automationQuerySchema>): AutomationLogFilter {
  return {
    ...(q.automation_type ? { automationType: q.automation_type } : {}),
    ...(q.agent_name ? { agentName: q.agent_name } : {}),
    ...(q.origin_source ? { originSource: q.origin_source } : {}),
    ...(q.search ? { search: q.search } : {}),
    ...(q.from ? { from: q.from } : {}),
    ...(q.to ? { to: q.to } : {}),
    ...(q.limit !== undefined ? { limit: q.limit } : {}),
    ...(q.offset !== undefined ? { offset: q.offset } : {}),
  };
}

const mytrionAccessBody = z.object({
  mytrion: z.enum([...MYTRION_IDS] as [MytrionId, ...MytrionId[]]),
});

export async function auditLogRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * "Which internal user opened which Mytrion, when" — the security coverage that did not exist.
   * Written by the SPA's MytrionGuard, the single choke point every workspace entry passes through
   * (deep link, launcher tile, header switch, and auto-route into a home Mytrion alike).
   *
   * NOT admin-gated: every worker writes their own row. Identity is taken from the session, never
   * from the body, so the only thing a caller can influence is WHICH Mytrion it claims — and that
   * claim is checked against the caller's resolved grant and recorded as `granted`, which turns a
   * lie into its own signal rather than a hole. A denied entry is never collapsed.
   *
   * Collapsed to one row per (user, Mytrion) per session window: React re-mounts the guard on every
   * in-workspace navigation, so an uncollapsed row here would recreate the `auth.act_as` flood.
   */
  app.post('/audit/mytrion-access', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    const { mytrion } = mytrionAccessBody.parse(request.body);
    const zohoUserId = ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : null;
    let granted = ctx.allDepartmentAccess;
    if (!granted && zohoUserId) {
      const access = await mytrionAccessService.resolveWorkerAccess({
        tenantId: ctx.tenantId,
        zohoUserId,
        profileName: ctx.profiles?.[0] ?? null,
        zohoRole: ctx.callerRole ?? null,
        userName: ctx.userName ?? null,
      });
      granted = access.allDepartmentAccess || access.accessibleMytrions.includes(mytrion);
    }
    const written = await auditSessionEvent(ctx, {
      action: 'mytrion.access',
      status: granted ? 'ok' : 'denied',
      resourceType: 'mytrion',
      resourceId: mytrion,
      detail: {
        mytrion,
        granted,
        ...(ctx.impersonatorUserId ? { impersonatorUserId: ctx.impersonatorUserId } : {}),
      },
    });
    return { logged: written };
  });

  /**
   * Option lists for the filter dropdowns. Registered BEFORE the `/admin/audit` handler for
   * readability only — Fastify matches these static paths independently of declaration order.
   */
  app.get('/admin/audit/facets', guard, async (request) => {
    const ctx = requireAdmin(request);
    const facets = await auditRepo.facets(ctx);
    return { ...facets, loginActions: LOGIN_ACTIONS };
  });

  // Audit trail for the Mytrion Admin: who (user/name/profile/role/company) did what, when.
  app.get('/admin/audit', guard, async (request) => {
    const ctx = requireAdmin(request);
    const q = auditQuerySchema.parse(request.query);
    const filter = toAuditFilter(q);
    const [entries, total] = await Promise.all([
      auditRepo.list(ctx, filter),
      auditRepo.count(ctx, filter),
    ]);
    // Drop tenantId from the wire DTO; everything else is display data for the admin.
    return {
      entries: entries.map(({ tenantId: _tenantId, ...rest }) => rest),
      total,
    };
  });

  app.get('/admin/automation-logs/facets', guard, async (request) => {
    const ctx = requireAdmin(request);
    const facets = await withAutomationReadiness(() => automationLogRepo.facets(ctx));
    return { ...facets, originSources: [...AUTOMATION_ORIGIN_SOURCES] };
  });

  app.get('/admin/automation-logs', guard, async (request) => {
    const ctx = requireAdmin(request);
    const q = automationQuerySchema.parse(request.query);
    const filter = toAutomationFilter(q);
    const [entries, total] = await withAutomationReadiness(() =>
      Promise.all([automationLogRepo.list(ctx, filter), automationLogRepo.count(ctx, filter)]),
    );
    return {
      entries: entries.map(({ tenantId: _tenantId, ...rest }) => rest),
      total,
    };
  });
}
