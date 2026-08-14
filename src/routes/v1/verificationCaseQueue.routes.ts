/**
 * Decision Desk queue + billable helpers on Verification cases.
 * Register before `/verification/cases/:id` so `/export` is not captured as an id.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { VERIFICATION_CASE_STATUSES } from '../../db/schema/verification_cases.js';
import { VERIFICATION_OWNER_SCOPES } from '../../modules/verification/verificationCaseDesk.js';
import {
  claimVerificationCase,
  exportVerificationCases,
  generateVerificationPlaidLink,
  parseVerificationBankStatements,
  releaseVerificationCase,
  runVerificationIsoftpullAll,
  transferVerificationCaseUnavailable,
} from '../../modules/verification/verificationCaseQueue.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification cases');
}

function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification cases');
}

const idParams = z.object({ id: z.string().min(1).max(80) });
const noteBody = z.object({ note: z.string().max(2000).optional() });
const plaidBody = z.object({ regenerate: z.boolean().optional() });
const parseBody = z.object({
  attachmentIds: z.array(z.coerce.number().int().positive()).max(40).optional(),
});
const exportQuery = z.object({
  status: z.enum(VERIFICATION_CASE_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  unmatched: z.enum(['0', '1', 'true', 'false']).optional(),
  owner: z.enum(VERIFICATION_OWNER_SCOPES).optional(),
});

export async function verificationCaseQueueRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/cases/export', auth, async (request, reply) => {
    const ctx = requireVerificationRead(request);
    const query = exportQuery.parse(request.query);
    const { filename, csv } = await exportVerificationCases(ctx, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { query: query.q } : {}),
      unmatched: query.unmatched === '1' || query.unmatched === 'true',
      ...(query.owner ? { owner: query.owner } : {}),
    });
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });

  app.post<{ Params: { id: string } }>('/verification/cases/:id/claim', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const { id } = idParams.parse(request.params);
    const body = noteBody.parse(request.body ?? {});
    return claimVerificationCase(ctx, id, body.note);
  });

  app.post<{ Params: { id: string } }>('/verification/cases/:id/release', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const { id } = idParams.parse(request.params);
    const body = noteBody.parse(request.body ?? {});
    return releaseVerificationCase(ctx, id, body.note);
  });

  app.post('/verification/cases/:id/transfer', auth, async (request) => {
    requireVerificationWrite(request);
    idParams.parse(request.params);
    transferVerificationCaseUnavailable();
  });

  app.post<{ Params: { id: string } }>('/verification/cases/:id/plaid-link', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const { id } = idParams.parse(request.params);
    const body = plaidBody.parse(request.body ?? {});
    return generateVerificationPlaidLink(ctx, id, Boolean(body.regenerate));
  });

  app.post<{ Params: { id: string } }>(
    '/verification/cases/:id/bank-statements/parse',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = parseBody.parse(request.body ?? {});
      return parseVerificationBankStatements(ctx, id, body.attachmentIds);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/cases/:id/stages/isoftpull/run-all',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      return runVerificationIsoftpullAll(ctx, id);
    },
  );
}
