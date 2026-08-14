/**
 * Verification Mytrion → Orchestration config (`/v1/verification/stop-factors*`,
 * `/v1/verification/strategies*`). Proxies credit-platform /api/v1 so the pipeline
 * reads the same stop_factors rows and decision_strategies_json the mono UI writes.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  listVerificationStopFactors,
  listVerificationStrategies,
  saveVerificationStopFactor,
  saveVerificationStrategy,
  stopFactorWriteSchema,
  strategyWriteSchema,
} from '../../modules/verification/verificationStrategies.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification rules');
}

function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification rules');
}

const listStopQuery = z.object({
  stage: z.enum(['pre', 'post', 'decision']).optional(),
});
const stopFactorParams = z.object({
  id: z.coerce.number().int().positive(),
});
const strategyParams = z.object({
  id: z.string().trim().min(1).max(80),
});

export async function verificationStrategiesRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/stop-factors', auth, async (request) => {
    requireVerificationRead(request);
    const query = listStopQuery.parse(request.query);
    return listVerificationStopFactors(query.stage);
  });

  app.post('/verification/stop-factors', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const body = stopFactorWriteSchema.parse(request.body ?? {});
    return saveVerificationStopFactor(ctx, body);
  });

  app.put<{ Params: { id: string } }>('/verification/stop-factors/:id', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const { id } = stopFactorParams.parse(request.params);
    const body = stopFactorWriteSchema.parse(request.body ?? {});
    return saveVerificationStopFactor(ctx, body, id);
  });

  app.get('/verification/strategies', auth, async (request) => {
    requireVerificationRead(request);
    return listVerificationStrategies();
  });

  app.post('/verification/strategies', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const body = strategyWriteSchema.parse(request.body ?? {});
    return saveVerificationStrategy(ctx, body);
  });

  app.put<{ Params: { id: string } }>('/verification/strategies/:id', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const { id } = strategyParams.parse(request.params);
    const body = strategyWriteSchema.parse(request.body ?? {});
    return saveVerificationStrategy(ctx, body, id);
  });
}
