/**
 * Collection desk routes — the READ side: the Today worklist, cases (list + detail + invoices +
 * timeline + commitments) and Array tradeline snapshots.
 *
 * COLLECTION-gated. Writes live in `collectionActions.routes.ts` and the placement queue in
 * `collectionAgency.routes.ts` — three files rather than one because the 600-line cap is real and
 * because "what the desk can read" and "what the desk can change" are different review surfaces.
 *
 * Pagination is mandatory at the wire — array reports cap at 100, cases at 500 (the board needs
 * every open row; there are ~322). `/collection/array-reports/facets` is registered before `/:id`
 * so "facets" is never captured as an id, and `/collection/cases/worklist` would collide with
 * `/collection/cases/:id` so the worklist sits at its own top-level path instead.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  COLLECTION_CASE_STATUSES,
  COLLECTION_CLOSED_REASONS,
  COLLECTION_STAGES,
} from '../../db/schema/collection.js';
import { COLLECTION_ACTIVITY_KINDS } from '../../db/schema/collection_desk.js';
import { NotFoundError } from '../../lib/errors.js';
import { DESK_POLICY } from '../../modules/collection/deskPolicy.js';
import { WORKLIST_LANES } from '../../modules/collection/deskPolicy.js';
import { ARRAY_REPORTS_MAX_LIMIT, arrayReportRepo } from '../../repos/arrayReportRepo.js';
import {
  COLLECTION_ACTIVITY_MAX_LIMIT,
  collectionActivityRepo,
} from '../../repos/collectionActivityRepo.js';
import { COLLECTION_CASES_MAX_LIMIT, collectionCaseRepo } from '../../repos/collectionCaseRepo.js';
import { collectionPlacementRepo } from '../../repos/collectionPlacementRepo.js';
import { collectionPlanRepo } from '../../repos/collectionPlanRepo.js';
import { WORKLIST_MAX_LIMIT, collectionWorklistRepo } from '../../repos/collectionWorklistRepo.js';
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
  /** Saved views. Cheap server-side filters rather than a client pass over one page. */
  minRemaining: z.coerce.number().min(0).max(100_000_000).optional(),
  neverContacted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
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

const worklistQuery = z.object({
  lane: z.enum(WORKLIST_LANES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(WORKLIST_MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const activityQuery = z.object({
  kind: z.enum(COLLECTION_ACTIVITY_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(COLLECTION_ACTIVITY_MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function collectionRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  /**
   * Today. Lane counts describe the whole open book; `items` is the (optionally lane-filtered)
   * page. `scanTruncated` is surfaced rather than swallowed — a partial worklist that looks
   * complete is the failure mode this desk cannot afford.
   */
  app.get('/collection/worklist', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const result = await collectionWorklistRepo.worklist(ctx, worklistQuery.parse(request.query));
    return { ...result, policy: DESK_POLICY };
  });

  /** Header figures for Today. Whole book, never the current filter. */
  app.get('/collection/summary', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    return collectionWorklistRepo.recovery(ctx);
  });

  /**
   * The case book. `desk` is a sibling map rather than a field on each item so the finder-owned
   * DTO stays exactly what the finder writes and the desk's own state is visibly separate.
   */
  app.get('/collection/cases', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const result = await collectionCaseRepo.list(ctx, caseListQuery.parse(request.query));
    const desk = await collectionWorklistRepo.deskInfoByCase(
      ctx,
      result.items.map((row) => row.id),
    );
    return { ...result, desk: Object.fromEntries(desk) };
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

  /** The case timeline. `kind` narrows it to one of the feed's tabs. */
  app.get<{ Params: { id: string } }>('/collection/cases/:id/activity', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const { id } = idParams.parse(request.params);
    const owned = await collectionCaseRepo.findById(ctx, id);
    if (!owned) throw new NotFoundError('Collection case not found');
    return collectionActivityRepo.listByCase(ctx, id, activityQuery.parse(request.query));
  });

  /**
   * Everything the case record's right rail needs in one call: the active plan with its schedule,
   * every promise, and the carrier's latest Array filing. Three round trips from the browser for
   * three panels that always render together is three chances to paint a half-built rail.
   */
  app.get<{ Params: { id: string } }>('/collection/cases/:id/desk', auth, async (request) => {
    const ctx = requireCollectionRead(request);
    const { id } = idParams.parse(request.params);
    const row = await collectionCaseRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Collection case not found');
    const [plan, promises, tradeline] = await Promise.all([
      collectionPlanRepo.activePlan(ctx, id),
      collectionPlanRepo.listPromises(ctx, id),
      collectionPlacementRepo.latestForCarrier(ctx, row.carrierId),
    ]);
    return { plan, promises, tradeline, policy: DESK_POLICY };
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
