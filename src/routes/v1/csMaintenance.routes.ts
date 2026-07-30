/**
 * Customer Service Mytrion — Maintenance cases (/v1/cs/maintenance): a card list with search +
 * filters, and create/update.
 *
 * Reads and writes are BOTH Postgres. Zoho's Maintenance module was migrated once
 * (scripts/migrateMaintenanceFromZoho.ts) and is not consulted again — no endpoint here makes a
 * Zoho call, which is asserted in tests/unit/cs-maintenance-routes.test.ts. Picklist options come
 * from the canonical constants in maintenanceFields.ts unioned with the values actually present in
 * the table, so the dropdowns never depend on a Zoho round-trip.
 *
 * There is deliberately NO delete. `total_amount` on these rows is real money that feeds the prepay
 * ledger, so removing a case is an irreversible accounting hole; setting `status` to 'Cancelled' is
 * the reversible path and drops the case out of the active filters.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { searchCompanies } from '../../integrations/dwhCompanies.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  MAINTENANCE_EDITABLE,
  MAINTENANCE_PICKLISTS,
  money,
} from '../../modules/customerService/maintenanceFields.js';
import { maintenanceCaseRepo, type MaintenanceFilters } from '../../repos/maintenanceCaseRepo.js';
import type { NewMaintenanceCase } from '../../db/schema/maintenance_cases.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireCsAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'customer-service', 'Maintenance cases');
}

/** Our own cuid2, not Zoho's 18-digit id — Postgres owns these rows. */
const idParam = z.object({ id: z.string().regex(/^mtc_[a-z0-9]+$/, 'not a maintenance case id') });

/** `a,b,c` → ['a','b','c']. Empty segments dropped so a trailing comma is harmless. */
const csvList = z
  .string()
  .max(400)
  .transform((s) => s.split(',').map((v) => v.trim()).filter(Boolean));

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const listQuery = z
  .object({
    search: z.string().max(120).optional(),
    status: csvList.optional(),
    caseType: csvList.optional(),
    paymentMethod: csvList.optional(),
    paymentStatus: csvList.optional(),
    owner: z.string().max(60).optional(),
    carrierId: z.string().max(40).optional(),
    invoiced: z.enum(['true', 'false']).optional(),
    completed: z.enum(['true', 'false']).optional(),
    dateFrom: ymd.optional(),
    dateTo: ymd.optional(),
    sort: z.enum(['date', 'created', 'amount', 'company', 'carrier']).default('date'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(24),
  })
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, {
    message: 'dateFrom must be on or before dateTo',
  });

type ListQuery = z.infer<typeof listQuery>;

/** Values a client may send. Money arrives as a number or a string; lookups as plain ids. */
const fieldValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
const writeBody = z
  .record(fieldValue)
  .refine((v) => Object.keys(v).length > 0, 'no fields supplied');

const EDITABLE = new Set<string>(MAINTENANCE_EDITABLE);
const MONEY_FIELDS = new Set([
  'totalAmount',
  'completionCompensation',
  'halfCompletionCompensation',
  'leadCompensation',
]);
const DATE_FIELDS = new Set(['caseDate', 'caseCompletion']);
const BOOL_FIELDS = new Set(['invoiced']);

/**
 * Reject unknown keys loudly rather than dropping them.
 *
 * Silently ignoring a misspelled field is how a save appears to succeed while changing nothing —
 * exactly the Zoho wrong-casing failure mode this codebase keeps running into. Better a 400.
 */
function pickEditable(body: Record<string, unknown>): Partial<NewMaintenanceCase> {
  const out: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE.has(key)) {
      unknown.push(key);
      continue;
    }
    if (value === '' || value === null) {
      out[key] = null;
      continue;
    }
    if (MONEY_FIELDS.has(key)) out[key] = money(value);
    else if (DATE_FIELDS.has(key)) out[key] = String(value).slice(0, 10);
    else if (BOOL_FIELDS.has(key)) out[key] = value === true || value === 'true';
    else out[key] = String(value);
  }
  if (unknown.length > 0) {
    throw new AppError(`Field(s) not editable on a maintenance case: ${unknown.join(', ')}`, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      expose: true,
    });
  }
  return out as Partial<NewMaintenanceCase>;
}

/** Query params → repo filters (undefined-safe under exactOptionalPropertyTypes). */
function toFilters(q: ListQuery): MaintenanceFilters {
  return {
    ...(q.search !== undefined ? { search: q.search } : {}),
    ...(q.status !== undefined ? { status: q.status } : {}),
    ...(q.caseType !== undefined ? { caseType: q.caseType } : {}),
    ...(q.paymentMethod !== undefined ? { paymentMethod: q.paymentMethod } : {}),
    ...(q.paymentStatus !== undefined ? { paymentStatus: q.paymentStatus } : {}),
    ...(q.owner !== undefined ? { ownerZohoUserId: q.owner } : {}),
    ...(q.carrierId !== undefined ? { carrierId: q.carrierId } : {}),
    ...(q.invoiced !== undefined ? { invoiced: q.invoiced === 'true' } : {}),
    ...(q.completed !== undefined ? { completed: q.completed === 'true' } : {}),
    ...(q.dateFrom !== undefined ? { dateFrom: q.dateFrom } : {}),
    ...(q.dateTo !== undefined ? { dateTo: q.dateTo } : {}),
  };
}

/** Canonical options first (stable, curated order), then anything else the data actually holds. */
function unionOptions(canonical: readonly string[], present: string[]): string[] {
  const seen = new Set(canonical);
  return [...canonical, ...present.filter((v) => !seen.has(v))];
}

export async function csMaintenanceRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** Card list — one page plus the facet counts the filter chrome renders. */
  app.get('/cs/maintenance', guard, async (request) => {
    requireCsAccess(request);
    const q = listQuery.parse(request.query);
    const filters = toFilters(q);
    const [page, facets] = await Promise.all([
      maintenanceCaseRepo.listPage({
        page: q.page,
        perPage: q.perPage,
        sort: q.sort,
        dir: q.dir,
        ...filters,
      }),
      maintenanceCaseRepo.facets(filters),
    ]);
    return { ...page, facets };
  });

  /** Unfiltered totals for the header tiles. */
  app.get('/cs/maintenance/stats', guard, async (request) => {
    requireCsAccess(request);
    return maintenanceCaseRepo.facets({});
  });

  /** Dropdown options + the owner roster, all from Postgres. */
  app.get('/cs/maintenance/meta', guard, async (request) => {
    requireCsAccess(request);
    const [status, caseType, paymentMethod, paymentStatus, owners] = await Promise.all([
      maintenanceCaseRepo.distinctPicklistValues('status'),
      maintenanceCaseRepo.distinctPicklistValues('caseType'),
      maintenanceCaseRepo.distinctPicklistValues('paymentMethod'),
      maintenanceCaseRepo.distinctPicklistValues('paymentStatus'),
      maintenanceCaseRepo.distinctOwners(),
    ]);
    return {
      statusOptions: unionOptions(MAINTENANCE_PICKLISTS.status, status),
      caseTypeOptions: unionOptions(MAINTENANCE_PICKLISTS.caseType, caseType),
      paymentMethodOptions: unionOptions(MAINTENANCE_PICKLISTS.paymentMethod, paymentMethod),
      paymentStatusOptions: unionOptions(MAINTENANCE_PICKLISTS.paymentStatus, paymentStatus),
      owners,
      editableFields: [...MAINTENANCE_EDITABLE],
    };
  });

  /**
   * Company typeahead over the DWH — the create form's company picker.
   *
   * `octane.dim_company` is the authoritative company ↔ carrier-id map, which is the whole point:
   * picking a company here FILLS the carrier id, so an agent never types it. Results carry the carrier
   * id because 49 company names map to more than one carrier — the UI must show it so the pick is
   * unambiguous.
   */
  app.get('/cs/maintenance/lookup/companies', guard, async (request) => {
    requireCsAccess(request);
    const { q } = z.object({ q: z.string().min(2).max(120) }).parse(request.query);
    return { companies: await searchCompanies(q) };
  });

  /** One case. Unlike the list, this DOES include `raw` — provenance for a single record is cheap. */
  app.get('/cs/maintenance/:id', guard, async (request) => {
    requireCsAccess(request);
    const { id } = idParam.parse(request.params);
    const row = await maintenanceCaseRepo.getById(id);
    if (!row) {
      throw new AppError('Maintenance case not found', {
        statusCode: 404,
        code: 'NOT_FOUND',
        expose: true,
      });
    }
    return row;
  });

  /** Create. `source: 'mytrion'` marks a case that has no Zoho counterpart. */
  app.post('/cs/maintenance', guard, async (request, reply) => {
    const ctx = requireCsAccess(request);
    const data = pickEditable(writeBody.parse(request.body));
    if (!data.name || String(data.name).trim() === '') {
      throw new AppError('Company Name is required', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
    const row = await maintenanceCaseRepo.insert({
      ...data,
      source: 'mytrion',
      createdByUserId: ctx.userId,
      ...(ctx.userName !== undefined ? { createdByName: ctx.userName } : {}),
    });
    await auditFromContext(ctx, {
      action: 'cs.maintenance.create',
      status: 'ok',
      resourceType: 'maintenance_case',
      ...(row?.id !== undefined ? { resourceId: row.id } : {}),
      detail: {
        fields: Object.keys(data),
        name: String(data.name ?? ''),
        carrierId: String(data.carrierId ?? ''),
      },
    });
    return reply.code(201).send(row);
  });

  /** Update. */
  app.patch('/cs/maintenance/:id', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const { id } = idParam.parse(request.params);
    const data = pickEditable(writeBody.parse(request.body));
    const row = await maintenanceCaseRepo.update(id, {
      ...data,
      updatedByUserId: ctx.userId,
      ...(ctx.userName !== undefined ? { updatedByName: ctx.userName } : {}),
    });
    if (!row) {
      throw new AppError('Maintenance case not found', {
        statusCode: 404,
        code: 'NOT_FOUND',
        expose: true,
      });
    }
    await auditFromContext(ctx, {
      action: 'cs.maintenance.update',
      status: 'ok',
      resourceType: 'maintenance_case',
      resourceId: id,
      detail: { fields: Object.keys(data) },
    });
    return row;
  });
}
