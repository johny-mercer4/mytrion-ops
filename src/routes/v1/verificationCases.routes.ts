/**
 * Verification Mytrion → verification cases (`/v1/verification/cases*`).
 * Distinct from Sales `/verification/clients` and the DWH roster `/verification/roster`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  approveVerificationCaseStage,
  decideVerificationCase,
  getVerificationCase,
  listVerificationCases,
  refreshVerificationCase,
  runVerificationCaseStage,
} from '../../modules/verification/verificationCases.js';
import { VERIFICATION_CASE_STATUSES } from '../../db/schema/verification_cases.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification cases');
}

function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification cases');
}

const listQuery = z.object({
  status: z.enum(VERIFICATION_CASE_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  unmatched: z.enum(['0', '1', 'true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParams = z.object({ id: z.string().min(1).max(80) });
const stageParams = z.object({
  id: z.string().min(1).max(80),
  stageId: z.string().min(1).max(64),
});
const noteBody = z.object({ note: z.string().max(2000).optional() });
const decisionBody = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'REVIEW']),
  reason: z.string().max(2000).optional(),
});

export async function verificationCasesRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/cases', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const query = listQuery.parse(request.query);
    return listVerificationCases(ctx, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { query: query.q } : {}),
      unmatched: query.unmatched === '1' || query.unmatched === 'true',
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.get<{ Params: { id: string } }>('/verification/cases/:id', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const { id } = idParams.parse(request.params);
    return getVerificationCase(ctx, id);
  });

  app.post<{ Params: { id: string } }>('/verification/cases/:id/refresh', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const { id } = idParams.parse(request.params);
    return refreshVerificationCase(ctx, id);
  });

  app.post<{ Params: { id: string; stageId: string } }>(
    '/verification/cases/:id/stages/:stageId/run',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, stageId } = stageParams.parse(request.params);
      return runVerificationCaseStage(ctx, id, stageId);
    },
  );

  app.post<{ Params: { id: string; stageId: string } }>(
    '/verification/cases/:id/stages/:stageId/approve',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, stageId } = stageParams.parse(request.params);
      const body = noteBody.parse(request.body ?? {});
      return approveVerificationCaseStage(ctx, id, stageId, body.note);
    },
  );

  app.post<{ Params: { id: string } }>('/verification/cases/:id/decision', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const { id } = idParams.parse(request.params);
    const body = decisionBody.parse(request.body ?? {});
    return decideVerificationCase(ctx, id, body.decision, body.reason);
  });
}
