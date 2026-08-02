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
import { AsyncSWRCache } from '../../lib/asyncSWRCache.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  dispatchPreparedTouchpoint,
  listTouchpointsFor,
  prepareTouchpointInvocation,
} from '../../modules/touchpoints/dispatcher.js';
import { getTouchpoint } from '../../modules/touchpoints/catalog/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { TouchpointResult } from '../../modules/touchpoints/types.js';
import { buildCallerContext, callerIdentitySchema } from './callerIdentity.js';

const dispatchSchema = callerIdentitySchema.extend({
  params: z.record(z.unknown()).default({}),
});

const touchpointReadCache = new AsyncSWRCache(500);
const TOUCHPOINT_READ_TTL_MS = 90_000;
const TOUCHPOINT_READ_STALE_MS = 10 * 60_000;
const MUTATION_REPLAY_TTL_MS = 15 * 60_000;
const MUTATION_REPLAY_MAX = 1_000;

interface MutationReplay {
  signature: string;
  expiresAt: number;
  result: Promise<TouchpointResult>;
}

const mutationReplays = new Map<string, MutationReplay>();

/** Reads whose payload is identical for every user in a tenant can share one cache entry. */
const TENANT_SCOPED_READS = new Set(['dashboard.company']);

function readCachePrincipal(ctx: TenantContext, key: string): string {
  return TENANT_SCOPED_READS.has(key) ? 'tenant' : ctx.userId;
}

/** Stable cache identity for the flat/nested JSON params accepted by the touchpoint catalog. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function dispatchMutation(
  ctx: TenantContext,
  key: string,
  params: Record<string, unknown>,
  rawIdempotencyKey: string | string[] | undefined,
  run: () => Promise<TouchpointResult>,
): Promise<TouchpointResult> {
  const idempotencyKey = Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey;
  if (!idempotencyKey) return run();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new AppError('Idempotency-Key must contain 8–200 characters.', {
      statusCode: 400,
      code: 'INVALID_IDEMPOTENCY_KEY',
      expose: true,
    });
  }
  const now = Date.now();
  for (const [replayKey, replay] of mutationReplays) {
    if (replay.expiresAt <= now) mutationReplays.delete(replayKey);
  }
  const replayKey = `${ctx.tenantId}:${ctx.userId}:${key}:${idempotencyKey}`;
  const signature = stableJson(params);
  const existing = mutationReplays.get(replayKey);
  if (existing) {
    if (existing.signature !== signature) {
      throw new AppError('That idempotency key was already used with a different request.', {
        statusCode: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        expose: true,
      });
    }
    return existing.result;
  }
  const result = run().catch((error: unknown) => {
    mutationReplays.delete(replayKey);
    throw error;
  });
  mutationReplays.set(replayKey, {
    signature,
    expiresAt: now + MUTATION_REPLAY_TTL_MS,
    result,
  });
  while (mutationReplays.size > MUTATION_REPLAY_MAX) {
    const oldest = mutationReplays.keys().next().value as string | undefined;
    if (!oldest) break;
    mutationReplays.delete(oldest);
  }
  return result;
}

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
      // This always runs, including on an eventual cache hit. It is the security boundary that
      // prevents a cached Sales result from being served to a caller whose department view is not
      // authorized for that touchpoint.
      const invocation = await prepareTouchpointInvocation(ctx, key, params);
      const normalizedParams = invocation.params;
      const forceRequested = request.headers['x-cache-refresh'] === '1';
      // A user may refresh their own cache. Tenant-wide Company snapshots are shared between every
      // Sales user, so only an administrator may bypass that cache and trigger an upstream refresh.
      const force =
        forceRequested && (!TENANT_SCOPED_READS.has(key) || ctx.allDepartmentAccess);
      const execute = (): Promise<TouchpointResult> =>
        dispatchPreparedTouchpoint(ctx, invocation);
      const run = (): Promise<TouchpointResult> =>
        tp?.riskClass === 'read'
          ? execute()
          : dispatchMutation(
              ctx,
              key,
              normalizedParams,
              request.headers['idempotency-key'],
              execute,
            );
      const cached =
        tp?.riskClass === 'read'
          ? await touchpointReadCache.getOrLoad(
              `${ctx.tenantId}:${readCachePrincipal(ctx, key)}:${key}:${stableJson(normalizedParams)}`,
              run,
              {
                ttlMs: TOUCHPOINT_READ_TTL_MS,
                staleIfErrorMs: TOUCHPOINT_READ_STALE_MS,
                force,
              },
            )
          : null;
      const result = cached?.data ?? (await run());
      if (tp?.riskClass !== 'read') {
        // Mutations are uncommon and can affect multiple read models (case list + detail + counts).
        // Tenant-wide invalidation is intentionally conservative: it prevents a successful write
        // from being hidden behind a 90-second read cache without requiring every catalog entry to
        // maintain a fragile list of dependent keys.
        touchpointReadCache.invalidate(`${ctx.tenantId}:`);
      }
      if (shouldAudit) {
        await auditInvocation(ctx, key, 'ok', { ...baseDetail, params });
      }
      return {
        key: result.key,
        data: result.data,
        ...(cached
          ? {
              freshness: cached.freshness,
              generatedAt: cached.generatedAt,
              partial: cached.freshness === 'stale',
              sourceHealth: { [result.kind]: cached.freshness === 'stale' ? 'degraded' : 'ok' },
              ...(cached.staleReason ? { staleReason: cached.staleReason } : {}),
            }
          : {}),
      };
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
  // The catalog risk class is authoritative; client-provided headers cannot select a cheaper bucket.
  app.route({
    method: ['GET', 'POST'],
    url: '/touchpoints/:key(.*)',
    ...guard,
    config: {
      rateLimit: {
        max: (request: FastifyRequest) => {
          const raw = (request.params as { key?: string } | undefined)?.key ?? '';
          const touchpoint = getTouchpoint(decodeURIComponent(raw).replace(/^\//, ''));
          if (touchpoint?.riskClass === 'read') return 120;
          if (touchpoint?.riskClass === 'destructive') return 5;
          return 10;
        },
        timeWindow: '1 minute',
      },
    },
    handler: dispatchHandler,
  });
}
