/**
 * Verification Mytrion → "Existing clients" (`GET /v1/verification/roster*`).
 *
 * Deliberately a different path from `/verification/clients` in `verificationPipeline.routes.ts` —
 * that endpoint is the SALES redesign's own tab (the caller's deal-clients + a mock pipeline stage);
 * this is the Verification Mytrion's company-wide roster and must not collide with it.
 *
 * Gated on the `verification` department (matches `access/mytrions.config.ts`'s Verification Mytrion),
 * not `sales` — a Verification reviewer and a sales agent are different audiences for different data.
 * Read-only throughout: the DWH pool this reads is enforced read-only at the session level, and there
 * is nothing here for a caller to write.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError } from '../../lib/errors.js';
import {
  getVerificationClientDetail,
  listVerificationClients,
} from '../../modules/verification/verificationClients.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireVerificationAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification clients');
}

function dwhError(err: unknown): AppError {
  return new AppError('Data warehouse request failed', {
    statusCode: 502,
    code: 'DWH_ERROR',
    cause: err,
    expose: true,
  });
}

const carrierParams = z.object({ carrierId: z.string().min(1).max(64) });

export async function verificationClientsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  // The full roster, creditworthy-first (see listVerificationClients). Fetched once and cached
  // client-side — see hrData.ts-style useCachedLoad on the frontend — so this is the only round
  // trip a session normally makes.
  app.get('/verification/roster', auth, async (request) => {
    requireVerificationAccess(request);
    try {
      const items = await listVerificationClients();
      return { items, total: items.length };
    } catch (err) {
      throw dwhError(err);
    }
  });

  // One carrier's identity/contact detail — fetched when a roster card's modal opens.
  app.get<{ Params: { carrierId: string } }>(
    '/verification/roster/:carrierId',
    auth,
    async (request) => {
      requireVerificationAccess(request);
      const { carrierId } = carrierParams.parse(request.params);
      try {
        const detail = await getVerificationClientDetail(carrierId);
        if (!detail) throw new NotFoundError('Carrier not found');
        return detail;
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        throw dwhError(err);
      }
    },
  );
}
