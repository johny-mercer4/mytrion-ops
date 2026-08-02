/**
 * Sales Call Hub — agent-scoped merged call history (Mytrion + Zoho + optional Gong).
 *
 * View-as: identity comes from buildCallerContext (x-act-as-zoho-user-id), never from a query
 * spoof. Admins without View-as see only their own agent id's calls — not org-wide.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { listCallHubCalls } from '../../modules/sales/callHub.js';
import { RBACError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { buildCallerContext } from './callerIdentity.js';
import { requireDepartment } from './helpers.js';

const listQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  source: z.enum(['all', 'mytrion', 'zoho', 'gong']).optional(),
  status: z.enum(['all', 'answered', 'missed', 'unknown']).optional(),
  page: z.coerce.number().int().min(1).max(500).optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional(),
  /** @deprecated Prefer page_size; kept for older clients. */
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

function zohoUserId(ctx: TenantContext): string {
  if (!ctx.userId.startsWith('zoho:')) {
    throw new RBACError('A verified Zoho worker session is required');
  }
  return ctx.userId.slice('zoho:'.length);
}

function callDto(item: Awaited<ReturnType<typeof listCallHubCalls>>['calls'][number]) {
  return {
    id: item.id,
    source: item.source,
    direction: item.direction,
    status: item.status,
    phone: item.phone,
    startedAt: item.startedAt,
    durationSeconds: item.durationSeconds,
    result: item.result,
    subject: item.subject,
    linked: item.linked,
    sourceRefs: item.sourceRefs,
  };
}

export async function callHubRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/sales/call-hub/calls', auth, async (request) => {
    // Apply View-as BEFORE the sales gate so the effective agent must have sales access.
    const effective = await buildCallerContext(request, {});
    request.ctx = effective;
    const ctx = requireDepartment(request, 'sales', 'Sales Call Hub');
    const query = listQuerySchema.parse(request.query ?? {});
    const caller = zohoUserId(ctx);
    const pageSize = query.page_size ?? query.limit ?? 25;
    const result = await listCallHubCalls(ctx, caller, {
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      ...(query.source !== undefined ? { source: query.source } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
      pageSize,
    });
    await auditFromContext(ctx, {
      action: 'call_hub.list',
      status: 'ok',
      resourceType: 'call_hub',
      detail: {
        count: result.calls.length,
        total: result.total,
        page: result.page,
        source: query.source ?? 'all',
        agentZohoUserId: result.agentZohoUserId,
      },
    });
    return {
      calls: result.calls.map(callDto),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      agentZohoUserId: result.agentZohoUserId,
      aggregates: result.aggregates,
      sourceHealth: result.sourceHealth,
      freshness: result.freshness,
      generatedAt: result.generatedAt,
    };
  });
}
