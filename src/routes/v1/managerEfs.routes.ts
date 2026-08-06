/**
 * Manager Mytrion → EFS Console (`/v1/manager/efs/*`).
 *
 * A proxy in front of servercrm's `/api/efs/console`, scoped to Octane's own clients. Every route
 * is `management`-department gated; the endpoint is the security boundary regardless of any
 * per-card gating in the UI.
 *
 * Two handlers serve the whole vendor surface — one for reads, one for writes — because the
 * surface is declared as data in modules/manager/efsConsole/. Adding an endpoint is a descriptor,
 * not a route.
 *
 * ⚠️ WRITES ARE INERT. `FF_MANAGER_EFS_WRITES_ENABLED` defaults off, so `/actions/:key` validates
 * the body, writes an audit row and returns a preview of what WOULD be sent. Nothing reaches
 * servercrm. Arming is a flag plus a per-action allowlist — see efsConsole/dispatch.ts.
 */
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { EFS_ACTIONS, findAction } from '../../modules/manager/efsConsole/actions.js';
import {
  executeAction,
  isActionLive,
  previewAction,
  runFetcher,
  writePosture,
} from '../../modules/manager/efsConsole/dispatch.js';
import { EFS_FETCHERS, findFetcher } from '../../modules/manager/efsConsole/fetchers.js';
import { assertEfsCarrier, findEfsClient, listEfsRoster } from '../../modules/manager/efsConsole/roster.js';
import { EFS_WINDOW_MAX_DAYS } from '../../modules/manager/efsConsole/types.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function managerContext(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'management', 'EFS Console');
}

const carrierIdParam = z.string().regex(/^\d{1,20}$/, 'carrierId must be numeric');

const rosterQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(['all', 'active', 'inactive', 'debtor', 'suspended']).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export async function managerEfsRoutes(app: FastifyInstance): Promise<void> {
  const auth: RouteShorthandOptions = { onRequest: [app.sessionOrApiKey] };

  /**
   * What this console can do, as the SERVER sees it. The UI renders from this and holds no opinion
   * of its own: no client-side write toggle, no localStorage mode. If writes are off here, the UI
   * has no Execute control to hunt for.
   */
  app.get('/manager/efs/capabilities', auth, async (request) => {
    managerContext(request);
    const posture = writePosture();
    return {
      writes: {
        mode: posture.mode,
        liveActions: posture.liveActions,
        note:
          posture.mode === 'disabled'
            ? 'Writes are disabled. Actions validate and preview only; nothing is sent to EFS.'
            : 'Writes are armed for the listed actions only.',
      },
      windows: {
        txn7d: EFS_WINDOW_MAX_DAYS.txn7d,
        history90d: EFS_WINDOW_MAX_DAYS.history90d,
      },
      fetchers: EFS_FETCHERS.map((f) => ({
        key: f.key,
        side: f.side,
        label: f.label,
        window: f.window,
        latency: f.latency,
        health: f.health,
        ...(f.brokenReason ? { brokenReason: f.brokenReason } : {}),
        ...(f.pathParams ? { pathParams: f.pathParams } : {}),
        ...(f.query ? { query: f.query } : {}),
      })),
      actions: EFS_ACTIONS.map((a) => ({
        key: a.key,
        label: a.label,
        group: a.group,
        riskClass: a.riskClass,
        effect: a.effect,
        checks: a.checks ?? [],
        ui: a.ui,
        live: isActionLive(a, posture),
      })),
    };
  });

  /** The roster. dim_company only — no vendor traffic, so it paints instantly. */
  app.get('/manager/efs/clients', auth, async (request) => {
    managerContext(request);
    const query = rosterQuery.parse(request.query ?? {});
    const { rows, total } = await listEfsRoster(query);
    return { clients: rows, total, limit: query.limit ?? 50, offset: query.offset ?? 0 };
  });

  /** One client's warehouse context. Still no vendor traffic. */
  app.get<{ Params: { carrierId: string } }>('/manager/efs/clients/:carrierId', auth, async (request) => {
    managerContext(request);
    const carrierId = carrierIdParam.parse(request.params.carrierId);
    const client = await findEfsClient(carrierId);
    if (!client) throw new NotFoundError(`Carrier ${carrierId} is not an Octane client`);
    return { client };
  });

  /**
   * Run one catalogued read.
   *
   * `carrierId` is a query param rather than a path segment so one route serves both sides of the
   * catalog. Carrier-side fetchers assert scope BEFORE any vendor call, so an id we do not hold
   * costs a warehouse lookup rather than an EFS round trip.
   */
  app.get<{ Params: { key: string } }>('/manager/efs/fetch/:key', auth, async (request) => {
    managerContext(request);
    const fetcher = findFetcher(request.params.key);
    if (!fetcher) throw new NotFoundError(`Unknown EFS fetcher: ${request.params.key}`);

    const raw = (request.query ?? {}) as Record<string, string | undefined>;
    const params: Record<string, string> = {};
    if (fetcher.path.includes(':carrierId')) {
      const carrierId = carrierIdParam.parse(raw['carrierId']);
      await assertEfsCarrier(carrierId);
      params['carrierId'] = carrierId;
    }
    for (const name of fetcher.pathParams ?? []) {
      const value = raw[name];
      if (value === undefined || value === '') throw new ValidationError(`missing required parameter: ${name}`);
      params[name] = value;
    }
    return runFetcher(fetcher, { params, query: raw });
  });

  /** The POST-modelled reads (`children/by-ids`, `loads/bulk`) — a body, but semantically a GET. */
  app.post<{ Params: { key: string } }>('/manager/efs/fetch/:key', auth, async (request) => {
    managerContext(request);
    const fetcher = findFetcher(request.params.key);
    if (!fetcher) throw new NotFoundError(`Unknown EFS fetcher: ${request.params.key}`);
    if (fetcher.method !== 'POST') {
      throw new ValidationError(`${fetcher.key} is a GET fetcher`);
    }
    return runFetcher(fetcher, { params: {}, query: {}, body: request.body });
  });

  /**
   * Run — or, today, PREVIEW — one catalogued write.
   *
   * While writes are disabled this validates the body, records an audit row and returns exactly
   * what would have been sent. The audit row is logged as `status: 'ok'` with `detail.mode:
   * 'dry_run'`; `'denied'` is reserved for RBAC and flag refusals, so the arming review can tell a
   * refusal from a preview.
   */
  app.post<{ Params: { key: string } }>('/manager/efs/actions/:key', auth, async (request, reply) => {
    const ctx = managerContext(request);
    const action = findAction(request.params.key);
    if (!action) throw new NotFoundError(`Unknown EFS action: ${request.params.key}`);

    const body = (request.body ?? {}) as Record<string, unknown>;
    // Carrier scope applies to writes exactly as it does to reads.
    const rawCarrier = body['carrierId'];
    if (rawCarrier !== undefined) {
      await assertEfsCarrier(carrierIdParam.parse(String(rawCarrier)));
    }

    const posture = writePosture();
    if (!isActionLive(action, posture)) {
      const preview = previewAction(action, body, posture);
      await auditFromContext(ctx, {
        action: `manager.efs.${action.key}`,
        status: 'ok',
        resourceType: 'efs_action',
        resourceId: String(rawCarrier ?? action.key),
        detail: { mode: 'dry_run', reason: preview.reason, riskClass: action.riskClass },
      });
      reply.code(200);
      return { preview };
    }

    /*
     * Armed path. Not reachable today — FF_MANAGER_EFS_WRITES_ENABLED is off and no key is in
     * MANAGER_EFS_LIVE_ACTIONS. Anything money-moving or destructive additionally requires an
     * admin-equivalent caller (CLAUDE.md rule 7): the management department alone is not enough to
     * move funds.
     */
    if (action.riskClass !== 'write') {
      const privileged = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
      if (!privileged) {
        await auditFromContext(ctx, {
          action: `manager.efs.${action.key}`,
          status: 'denied',
          resourceType: 'efs_action',
          resourceId: String(rawCarrier ?? action.key),
          detail: { reason: 'requires_admin', riskClass: action.riskClass },
        });
        throw new ValidationError(`${action.key} moves money or destroys a record and requires an admin caller`);
      }
    }

    const result = await executeAction(action, body);
    await auditFromContext(ctx, {
      action: `manager.efs.${action.key}`,
      status: 'ok',
      resourceType: 'efs_action',
      resourceId: String(rawCarrier ?? action.key),
      detail: { mode: 'live', riskClass: action.riskClass },
    });
    return { executed: true, result };
  });
}
