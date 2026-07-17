/**
 * Touchpoints (/v1/touchpoints) — the generic dispatcher over the legacy-widget catalog
 * (Deluge functions + servercrm endpoints), the Sales Mytrion's calling surface.
 *
 * One route executes any catalog entry; per-key zod validation, RBAC, identity
 * injection, and carrier ownership live in the dispatcher. Success = 200 { key, data };
 * failures are ALWAYS non-2xx (never 200-with-embedded-error). Writes and destructive
 * calls are audited (ok + error); denials are audited for every risk class; successful
 * reads are not (repo convention — the request log covers them).
 *
 * Methods: POST is the primary verb (body: { departmentAccess, params }). GET is also
 * accepted for read-class keys — some proxies/redirects turn POST into GET (301/302),
 * and a few clients probe with GET. Writes stay POST-only.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
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

function parseDepartmentAccessCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** GET query → dispatcher params. Supports `params=<json>` or flat query keys (minus identity). */
function paramsFromQuery(query: Record<string, unknown>): Record<string, unknown> {
  const raw = query.params;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new AppError('Query param "params" must be valid JSON', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    if (k === 'params' || k === 'department_access' || k === 'departmentAccess') continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
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
    const departmentAccess = parseDepartmentAccessCsv(q.department_access);
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

  const dispatchHandler = async (request: FastifyRequest) => {
    const { key: rawKey } = request.params as { key: string };
    // Wildcard catch-all may include a leading slash depending on Fastify version.
    const key = decodeURIComponent(rawKey).replace(/^\//, '');
    const isGet = request.method === 'GET';

    let departmentAccess: string[] | undefined;
    let params: Record<string, unknown>;

    if (isGet) {
      const q = request.query as Record<string, unknown>;
      const deptRaw =
        typeof q.department_access === 'string'
          ? q.department_access
          : typeof q.departmentAccess === 'string'
            ? q.departmentAccess
            : undefined;
      departmentAccess = parseDepartmentAccessCsv(deptRaw) ?? ['sales'];
      params = paramsFromQuery(q);

      const tpEarly = getTouchpoint(key);
      if (tpEarly && tpEarly.riskClass !== 'read') {
        throw new AppError(`Touchpoint '${key}' requires POST (not a read)`, {
          statusCode: 405,
          code: 'METHOD_NOT_ALLOWED',
          expose: true,
        });
      }
    } else {
      const body = dispatchSchema.parse(request.body ?? {});
      departmentAccess = body.departmentAccess;
      params = body.params as Record<string, unknown>;
    }

    const ctx = await buildCallerContext(
      request,
      departmentAccess && departmentAccess.length > 0 ? { departmentAccess } : {},
    );
    const tp = getTouchpoint(key);
    const shouldAudit = tp !== undefined && tp.riskClass !== 'read';
    const baseDetail: Record<string, unknown> = tp
      ? {
          kind: tp.kind,
          riskClass: tp.riskClass,
          ...(tp.carrierParam &&
          typeof params[tp.carrierParam] !== 'undefined'
            ? { carrierId: String(params[tp.carrierParam]) }
            : {}),
        }
      : {};
    try {
      const result = await dispatchTouchpoint(ctx, key, params);
      if (shouldAudit) {
        await auditInvocation(ctx, key, 'ok', { ...baseDetail, params });
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
          params: redactParams(params),
          error: err instanceof AppError ? err.message : 'internal error',
        });
      }
      throw err;
    }
  };

  // `:key` with an explicit regex so dotted keys (clients.by_agent) always bind as one segment.
  app.route({
    method: ['GET', 'POST'],
    url: '/touchpoints/:key(.*)',
    ...guard,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: dispatchHandler,
  });
}
