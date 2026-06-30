import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { moneyCodeRequestRepo } from '../../repos/moneyCodeRequestRepo.js';
import { requireContext } from './helpers.js';

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

/**
 * Money codes — issue (or fetch the existing) money-code request for a carrier+invoice.
 * Idempotent on (carrier_id, invoice_id): a duplicate returns the existing row with 200, a new
 * insert returns 201. Auth: API_KEY. `requested_by` defaults to the caller's user name from context.
 */
export async function moneyCodeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/money-codes', { onRequest: [app.apiKeyAuth] }, async (request, reply) => {
    const ctx = requireContext(request);
    const body = bodySchema.parse(request.body);
    // Light normalize: trim, store null if empty/absent. No format check (see schema note).
    const email = typeof body.email === 'string' ? body.email.trim() || null : null;
    const { row, created } = await moneyCodeRequestRepo.insert({
      ...body,
      email,
      requestedBy: body.requestedBy ?? ctx.userName,
    });
    reply.code(created ? 201 : 200);
    return { created, request: row };
  });
}
