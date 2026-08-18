/**
 * Collection desk routes — cases (list + detail + invoices) and Array tradeline snapshots.
 *
 * COLLECTION-gated. Read-only: advancing a case is a write and is not exposed here. Pagination
 * is mandatory at the wire — array reports cap at 100, cases at 500 (the board needs every open
 * row; there are ~322). `/collection/array-reports/facets` is registered before `/:id` so
 * "facets" is never captured as an id.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  COLLECTION_CASE_STATUSES,
  COLLECTION_CLOSED_REASONS,
  COLLECTION_STAGES,
} from '../../db/schema/collection.js';
import { NotFoundError } from '../../lib/errors.js';
import { ARRAY_REPORTS_MAX_LIMIT, arrayReportRepo } from '../../repos/arrayReportRepo.js';
import { COLLECTION_CASES_MAX_LIMIT, collectionCaseRepo } from '../../repos/collectionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireCollectionRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'collection', 'Collection cases');
}

const caseListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(COLLECTION_CASES_MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(COLLECTION_CASE_STATUSES).optional(),
  stage: z.enum(COLLECTION_STAGES).optional(),
  closedReason: z.enum(COLLECTION_CLOSED_REASONS).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const arrayListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(ARRAY_REPORTS_MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  reportPeriod: z.string().trim().min(1).max(40).optional(),
  accountStatus: z.string().trim().min(1).max(8).optional(),
  agency: z.string().trim().min(1).max(120).optional(),
  needsDobLookup: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const idParams = z.object({ id: z.string().min(1).max(80) });

const invoiceQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/collection/cases', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    return collectionCaseRepo.list(ctx, caseListQuery.parse(request.query));
  });

  app.get<{ Params: { id: string } }>('/collection/cases/:id', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const { id } = idParams.parse(request.params);
    const row = await collectionCaseRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Collection case not found');
    return { case: row };
  });

  app.get<{ Params: { id: string } }>('/collection/cases/:id/invoices', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const { id } = idParams.parse(request.params);
    const owned = await collectionCaseRepo.findById(ctx, id);
    if (!owned) throw new NotFoundError('Collection case not found');
    return collectionCaseRepo.listInvoices(ctx, id, invoiceQuery.parse(request.query));
  });

  app.get('/collection/array-reports/facets', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    return arrayReportRepo.facets(ctx);
  });

  app.get('/collection/array-reports', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    return arrayReportRepo.list(ctx, arrayListQuery.parse(request.query));
  });

  app.get<{ Params: { id: string } }>('/collection/array-reports/:id', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const { id } = idParams.parse(request.params);
    const row = await arrayReportRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Array report not found');
    return { report: row };
  });
}
