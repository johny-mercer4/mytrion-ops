import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { moneyCodeRequestRepo } from '../../repos/moneyCodeRequestRepo.js';
import { requireDepartment } from './helpers.js';

const bodySchema = z.object({
  carrierId: z.coerce.number().int().positive(),
  invoiceId: z.coerce.number().int().positive(),
  invoiceAmount: z.coerce.number().nonnegative().optional(),
  limitPct: z.coerce.number().min(0).max(9999.99).optional(),
  moneyCodeAmount: z.coerce.number().nonnegative().optional(),
  billingType: z.string().min(1).max(100).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validUntil must be YYYY-MM-DD').optional(),
  status: z.enum(['ISSUED', 'VOIDED']).optional(),
  efsMoneyCode: z.string().min(1).max(200).optional(),
  requestedBy: z.string().min(1).max(200).optional(),
  // Company email (from DWH dim_company). Intentionally NOT format-validated — a malformed address
  // must never block issuing a money code. Accepts string | null | omitted; normalized below.
  email: z.string().nullish(),
});

const listQuerySchema = z.object({
  status: z.enum(['ISSUED', 'VOIDED']).optional(),
  generatedBefore: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(200),
  order: z.enum(['asc', 'desc']).default('asc'), // oldest-first by default (natural for a void sweep)
});

const voidParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const voidBodySchema = z.object({ reason: z.string().max(500).nullish() });

/**
 * Money codes service (Ops DB ledger). Auth: session or API key.
 * Agent Data Center list/void go through local touchpoints (`money_code.list` /
 * `money_code.void`); these HTTP routes remain for insert + void-sweep tooling.
 *  - POST  /money-codes            insert a draw row
 *  - GET   /money-codes            list for the void sweep (status / generatedBefore / limit / order)
 *  - POST  /money-codes/:id/void   mark one record (batch) voided — DB only, no EFS
 */
export async function moneyCodeRoutes(app: FastifyInstance): Promise<void> {
  // Issue (or return the existing active) money-code request. 201 created / 200 already-issued.
  app.post('/money-codes', { onRequest: [app.sessionOrApiKey] }, async (request, reply) => {
    const ctx = requireDepartment(request, 'billing', 'Money codes');
    const body = bodySchema.parse(request.body);
    // Light normalize: trim, store null if empty/absent. No format check (see schema note).
    const email = typeof body.email === 'string' ? body.email.trim() || null : null;
    const { row, created } = await moneyCodeRequestRepo.insert({
      ...body,
      email,
      requestedBy: body.requestedBy ?? ctx.userName,
    });
    await auditFromContext(ctx, {
      action: 'money_code.create',
      status: 'ok',
      resourceType: 'money_code_request',
      resourceId: String(row.id),
      detail: { carrierId: body.carrierId, invoiceId: body.invoiceId, created },
    });
    reply.code(created ? 201 : 200);
    return { created, request: row };
  });

  // List records (the servercrm 72h auto-void cron reads this to find expired ISSUED codes).
  app.get('/money-codes', { onRequest: [app.sessionOrApiKey] }, async (request) => {
    const ctx = requireDepartment(request, 'billing', 'Money codes');
    const q = listQuerySchema.parse(request.query);
    // Non-admin billing workers see only their own draws (efs code fields stripped by
    // listForAgent). The system/admin void-sweep keeps the full unscoped ledger it relies on.
    if (ctx.role !== 'admin' && !ctx.allDepartmentAccess) {
      const scoped = await moneyCodeRequestRepo.listForAgent({
        requestedBy: ctx.userName ?? '',
        page: 1,
        limit: q.limit,
        ...(q.status ? { status: q.status } : {}),
      });
      return { data: scoped.data };
    }
    const data = await moneyCodeRequestRepo.list({
      status: q.status,
      generatedBefore: q.generatedBefore ? new Date(q.generatedBefore) : undefined,
      limit: q.limit,
      order: q.order,
    });
    return { data };
  });

  // Void one record. Idempotent: already-VOIDED is a 200 no-op. Frees (carrier, invoice) for re-issue.
  app.post('/money-codes/:id/void', { onRequest: [app.sessionOrApiKey] }, async (request) => {
    const ctx = requireDepartment(request, 'billing', 'Money codes');
    const { id } = voidParamsSchema.parse(request.params);
    const parsed = voidBodySchema.parse(request.body ?? {});
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() || null : null;
    const row = await moneyCodeRequestRepo.voidById(id, reason);
    if (!row) throw new NotFoundError(`Money code request ${id} not found`);
    await auditFromContext(ctx, {
      action: 'money_code.void',
      status: 'ok',
      resourceType: 'money_code_request',
      resourceId: String(id),
      detail: { reason },
    });
    return { voided: true, request: row };
  });
}
