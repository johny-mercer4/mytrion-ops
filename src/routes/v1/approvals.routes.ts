/**
 * Human-in-the-loop approval endpoints (admin/allDepartmentAccess only): list pending
 * proposals, approve (→ execute under the proposer's snapshot), deny. Decisions happen ONLY
 * through this authenticated HTTP surface — never via Telegram callbacks.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { executeApproval } from '../../modules/agents/approvalExecutor.js';
import { approvalRepo } from '../../repos/approvalRepo.js';
import type { Approval } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { buildCallerContext, callerIdentitySchema } from './callerIdentity.js';

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'denied', 'expired', 'executed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function approvalDto(a: Approval) {
  return {
    id: a.id,
    toolName: a.toolName,
    riskClass: a.riskClass,
    arguments: a.arguments,
    requestedBy: a.requestedBy,
    actingAgent: a.actingAgent ?? null,
    conversationId: a.conversationId ?? null,
    status: a.status,
    approvedBy: a.approvedBy ?? null,
    result: a.result ?? null,
    expiresAt: a.expiresAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}

function requireAdmin(ctx: TenantContext): void {
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
    throw new RBACError('Approvals require all-department (admin) access');
  }
}

export async function approvalsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.apiKeyAuth] };

  app.get('/approvals', guard, async (request) => {
    const q = listQuery.parse(request.query);
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    requireAdmin(ctx);
    const rows = await approvalRepo.list(ctx, q.status ?? 'pending', q.limit ?? 50);
    return { approvals: rows.map(approvalDto) };
  });

  app.post<{ Params: { id: string } }>('/approvals/:id/approve', guard, async (request) => {
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.body ?? {}));
    requireAdmin(ctx);
    const decided = await approvalRepo.decide(ctx, request.params.id, 'approved', ctx.userName ?? ctx.userId);
    if (!decided) throw new NotFoundError('Approval not found, already decided, or expired');
    const outcome = await executeApproval(ctx, decided);
    return { approval: approvalDto({ ...decided, status: outcome.status }), outcome };
  });

  app.post<{ Params: { id: string } }>('/approvals/:id/deny', guard, async (request) => {
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.body ?? {}));
    requireAdmin(ctx);
    const decided = await approvalRepo.decide(ctx, request.params.id, 'denied', ctx.userName ?? ctx.userId);
    if (!decided) throw new NotFoundError('Approval not found, already decided, or expired');
    return { approval: approvalDto(decided) };
  });
}
