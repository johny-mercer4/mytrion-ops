/**
 * Collection → Agency. The placement queue that sits in FRONT of the Array filing.
 *
 * `/collection/array-reports` (in collection.routes.ts) serves the filed book. This serves the
 * work: which open cases clear the agency thresholds, which are blocked, and on which Metro 2
 * field. Registered as its own plugin so `/collection/placement-queue` cannot be captured by the
 * `/collection/cases/:id` parameterised routes.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DESK_POLICY } from '../../modules/collection/deskPolicy.js';
import {
  METRO2_FIELDS,
  PLACEMENT_MAX_LIMIT,
  collectionPlacementRepo,
} from '../../repos/collectionPlacementRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireCollectionRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'collection', 'Collection agency queue');
}

const queueQuery = z.object({
  state: z.enum(['ready', 'blocked', 'error', 'hold', 'filed']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(PLACEMENT_MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function collectionAgencyRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/collection/placement-queue', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const result = await collectionPlacementRepo.queue(ctx, queueQuery.parse(request.query));
    // The field ORDER is part of the contract: the readiness dots render left to right in it, and
    // a client that re-derived the order from an object's keys would be relying on insertion order.
    return { ...result, metro2Fields: METRO2_FIELDS, policy: DESK_POLICY };
  });
}
