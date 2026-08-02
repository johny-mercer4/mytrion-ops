/**
 * Sales shell bootstrap — one owner-scoped request for identity, permissions, badges and the Home
 * reads needed above the fold. Every database access remains in a tenant-isolated repository; the
 * external reads still pass through the touchpoint dispatcher (RBAC is rechecked there).
 */
import type { FastifyInstance } from 'fastify';
import { AsyncSWRCache } from '../../lib/asyncSWRCache.js';
import { getCommsSchemaReadiness } from '../../modules/comms/readiness.js';
import { dispatchTouchpoint } from '../../modules/touchpoints/dispatcher.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { mytrionInboxMessageRepo } from '../../repos/mytrionInboxMessageRepo.js';
import { workerTaskRepo } from '../../repos/workerTaskRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { buildCallerContext } from './callerIdentity.js';
import { requireDepartment } from './helpers.js';

const bootstrapCache = new AsyncSWRCache(200);

type Health = 'ok' | 'degraded' | 'disabled';

function zohoUserId(ctx: TenantContext): string {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : ctx.userId;
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

export async function salesBootstrapRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.authenticate] };

  app.get('/sales/bootstrap', guard, async (request) => {
    const effective = await buildCallerContext(request, { departmentAccess: ['sales'] });
    request.ctx = effective;
    const ctx = requireDepartment(request, 'sales', 'Sales Mytrion');
    const ownerId = zohoUserId(ctx);
    const key = `sales-bootstrap:${ctx.tenantId}:${ctx.userId}`;
    const force = ctx.allDepartmentAccess && request.headers['x-cache-refresh'] === '1';

    const cached = await bootstrapCache.getOrLoad(
      key,
      async () => {
        const commsReadiness = await getCommsSchemaReadiness().catch(() => ({
          ready: false,
          missing: ['readiness_check_failed'],
        }));
        const [inbox, tasks, unread, snapshot, debtors, activity, announcements] =
          await Promise.allSettled([
          mytrionInboxMessageRepo.countsForOwner(ctx, ownerId),
          workerTaskRepo.countByStatus(ctx, ownerId),
          commsReadiness.ready
            ? commsThreadMemberRepo.unreadTotals(ctx, {
                memberKind: 'worker',
                memberKey: ownerId,
              })
            : Promise.resolve([]),
          dispatchTouchpoint(ctx, 'dashboard.home_snapshot', {}),
          dispatchTouchpoint(ctx, 'dashboard.debtors', { summaryOnly: true }),
          dispatchTouchpoint(ctx, 'activity.agent', { range: 'daily' }),
          dispatchTouchpoint(ctx, 'inbox.announcements', {}),
          ]);

        const inboxCounts = fulfilled(inbox);
        const taskCounts = fulfilled(tasks);
        const unreadRows = fulfilled(unread);
        const sourceHealth: Record<string, Health> = {
          database: inboxCounts && taskCounts ? 'ok' : 'degraded',
          communications: !commsReadiness.ready ? 'disabled' : unreadRows ? 'ok' : 'degraded',
          homeSnapshot: snapshot.status === 'fulfilled' ? 'ok' : 'degraded',
          debtors: debtors.status === 'fulfilled' ? 'ok' : 'degraded',
          activity: activity.status === 'fulfilled' ? 'ok' : 'degraded',
          announcements: announcements.status === 'fulfilled' ? 'ok' : 'degraded',
        };
        for (const [source, result] of [
          ['inbox', inbox],
          ['tasks', tasks],
          ['communications', unread],
          ['homeSnapshot', snapshot],
          ['debtors', debtors],
          ['activity', activity],
          ['announcements', announcements],
        ] as const) {
          if (result.status === 'rejected') {
            request.log.warn({ err: result.reason, source }, 'sales bootstrap source degraded');
          }
        }

        return {
          identity: {
            userId: ctx.userId,
            zohoUserId: ownerId,
            name: ctx.userName ?? null,
            profile: ctx.profiles?.[0] ?? null,
            actingAs: ctx.impersonatorUserId != null,
          },
          permissions: {
            role: ctx.role,
            departments: ctx.departments,
            allDepartmentAccess: ctx.allDepartmentAccess,
            mytrionAccessModes: ctx.mytrionAccessModes ?? {},
          },
          badges: {
            inbox: inboxCounts?.unread ?? 0,
            inboxCounts,
            tasks: taskCounts ? taskCounts.open + taskCounts.in_progress : 0,
            tickets: unreadRows?.reduce((sum, row) => sum + row.unread, 0) ?? 0,
            taskCounts,
          },
          home: {
            snapshot: snapshot.status === 'fulfilled' ? snapshot.value.data : null,
            debtors: debtors.status === 'fulfilled' ? debtors.value.data : null,
            activity: activity.status === 'fulfilled' ? activity.value.data : null,
            announcements:
              announcements.status === 'fulfilled' ? announcements.value.data : null,
          },
          sourceHealth,
          partial: Object.values(sourceHealth).some((health) => health === 'degraded'),
          communicationsReady: commsReadiness.ready,
        };
      },
      { ttlMs: 60_000, staleIfErrorMs: 10 * 60_000, force },
    );

    return {
      ...cached.data,
      freshness: cached.freshness,
      generatedAt: cached.generatedAt,
      ...(cached.staleReason ? { staleReason: cached.staleReason } : {}),
    };
  });
}
