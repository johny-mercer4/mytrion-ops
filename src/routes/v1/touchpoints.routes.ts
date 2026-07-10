/**
 * Touchpoints (/v1/touchpoints) — the generic dispatcher over the legacy-widget catalog
 * (Deluge functions + servercrm endpoints), the Sales Mytrion's calling surface.
 *
 * One POST route executes any catalog entry; per-key zod validation, RBAC, identity
 * injection, and carrier ownership live in the dispatcher. Success = 200 { key, data };
 * failures are ALWAYS non-2xx (never 200-with-embedded-error). Writes and destructive
 * calls are audited (ok + error); denials are audited for every risk class; successful
 * reads are not (repo convention — the request log covers them).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  dispatchTouchpoint,
  listTouchpointsFor,
} from '../../modules/touchpoints/dispatcher.js';
import { getTouchpoint } from '../../modules/touchpoints/catalog/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { buildCallerContext, callerIdentitySchema } from './callerIdentity.js';

const dispatchSchema = callerIdentitySchema.extend({
  params: z.record(z.unknown()).default({}),
});

/** Mask full card numbers (PAN) in audited params — keep the last 4 for traceability. */
function redactParams(params: unknown): unknown {
  if (typeof params !== 'object' || params === null) return params;
  const out: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  if (typeof out.cardNumber === 'string' && out.cardNumber.length > 4) {
    out.cardNumber = `•••• ${out.cardNumber.slice(-4)}`;
  }
  return out;
}

async function auditInvocation(
  ctx: TenantContext,
  key: string,
  status: 'ok' | 'error' | 'denied',
  detail: Record<string, unknown>,
): Promise<void> {
  await auditFromContext(ctx, {
    action: `touchpoint.${key}`,
    status,
    resourceType: 'touchpoint',
    resourceId: key,
    detail,
  });
}

export async function touchpointsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * Discovery: the touchpoints THIS caller may invoke (drives UI enable/disable).
   * Non-admin workers declare their department view like every other surface — here via
   * ?department_access=sales (CSV), the query-string mirror of the POST body field.
   */
  app.get('/touchpoints', guard, async (request) => {
    const q = z
      .object({ department_access: z.string().max(300).optional() })
      .parse(request.query);
    const departmentAccess = q.department_access
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ctx = await buildCallerContext(
      request,
      departmentAccess && departmentAccess.length > 0 ? { departmentAccess } : {},
    );
    const touchpoints = listTouchpointsFor(ctx).map((tp) => ({
      key: tp.key,
      title: tp.title,
      kind: tp.kind,
      riskClass: tp.riskClass,
    }));
    return { touchpoints };
  });

  app.post(
    '/touchpoints/:key',
    { ...guard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const { key } = request.params as { key: string };
      const body = dispatchSchema.parse(request.body ?? {});
      const ctx = await buildCallerContext(request, body);
      const tp = getTouchpoint(key);
      const shouldAudit = tp !== undefined && tp.riskClass !== 'read';
      const baseDetail: Record<string, unknown> = tp
        ? {
            kind: tp.kind,
            riskClass: tp.riskClass,
            ...(tp.carrierParam &&
            typeof (body.params as Record<string, unknown>)[tp.carrierParam] !== 'undefined'
              ? { carrierId: String((body.params as Record<string, unknown>)[tp.carrierParam]) }
              : {}),
          }
        : {};
      try {
        const result = await dispatchTouchpoint(ctx, key, body.params);
        if (shouldAudit) {
          await auditInvocation(ctx, key, 'ok', { ...baseDetail, params: body.params });
        }
        return { key: result.key, data: result.data };
      } catch (err) {
        if (err instanceof RBACError) {
          await auditInvocation(ctx, key, 'denied', {
            ...baseDetail,
            reason: err.message,
          });
        } else if (shouldAudit) {
          await auditInvocation(ctx, key, 'error', {
            ...baseDetail,
            params: redactParams(body.params),
            error: err instanceof AppError ? err.message : 'internal error',
          });
        }
        throw err;
      }
    },
  );
}
