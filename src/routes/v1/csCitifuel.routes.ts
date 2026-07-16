/**
 * Customer Service Mytrion — Citifuel Clients (/v1/cs/citifuel): list/search, live
 * picklist metadata, per-status stats, Accounts/users typeaheads, and full CRUD on the
 * CRM `Citifuel_Clients` module (widget parity: citi-fuel-panel.js).
 *
 * Stats are server-built COQL COUNT queries — the widget's `citigetstats` Deluge accepted
 * a raw client-supplied COQL string, which is an injection surface we deliberately do not
 * reproduce. Writes are casing-resolved and audited; delete carries a record snapshot.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  getPicklistValues,
  resolveWritePayload,
} from '../../modules/customerService/fieldResolver.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const CITI_MODULE = 'Citifuel_Clients';

/** List fields (CITI_FIELD_CONFIG + Created_Time — the widget's select list). */
const CITI_FIELDS = [
  'Name',
  'App_ID',
  'Company_Name',
  'Request',
  'Status_of_App',
  'Actions_taken',
  'Final_Decision',
  'Billing_Notes',
  'Date_of_Request',
  'Feedback_date',
  'Email',
  'Phone_Number',
  'Agent_Name',
  'Owner',
  'Notes_1',
  'Created_By',
  'Modified_By',
  'Created_Time',
] as const;

/** Editable allowlist for create/update (readonly audit fields excluded). */
const EDITABLE = new Set([
  'Name',
  'App_ID',
  'Company_Name',
  'Request',
  'Status_of_App',
  'Actions_taken',
  'Final_Decision',
  'Billing_Notes',
  'Date_of_Request',
  'Feedback_date',
  'Email',
  'Phone_Number',
  'Agent_Name',
  'Owner',
  'Notes_1',
]);

function requireCsAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'customer-service', 'Citifuel clients');
}

const idParam = z.object({ id: z.string().regex(/^\d+$/, 'id must be a CRM record id').max(60) });

const listQuery = z.object({
  status: z
    .string()
    .max(60)
    .regex(/^[\w \-/&.]+$/, 'invalid status value')
    .optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});

/** Lookup values arrive as {id} objects; scalars cover text/number/date/bool fields. */
const fieldValue = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ id: z.string().max(60) }).strict(),
]);

const writeBody = z
  .record(fieldValue)
  .refine((v) => Object.keys(v).length > 0, 'no fields supplied');

function pickEditable(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    const match = [...EDITABLE].find((f) => f.toLowerCase() === key.toLowerCase());
    if (!match) {
      unknown.push(key);
      continue;
    }
    out[match] = value;
  }
  if (unknown.length > 0) {
    throw new AppError(`Field(s) not editable on Citifuel: ${unknown.join(', ')}`, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      expose: true,
    });
  }
  return out;
}

/** COQL string literal (single quotes doubled). Statuses are already shape-validated. */
function coqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function csCitifuelRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** Paged list — plain, status-filtered, or searched (numeric = App_ID, text = word). */
  app.get('/cs/citifuel', guard, async (request) => {
    requireCsAccess(request);
    const q = listQuery.parse(request.query);
    const paging = { page: q.page, perPage: q.perPage };
    if (q.search && /^\d+$/.test(q.search.trim())) {
      const appId = q.search.trim();
      const criteria = q.status
        ? `((Status_of_App:equals:${q.status})and(App_ID:equals:${appId}))`
        : `(App_ID:equals:${appId})`;
      return zohoCrmRecords.searchRecords(CITI_MODULE, { criteria, fields: CITI_FIELDS, ...paging });
    }
    if (q.search) {
      const page = await zohoCrmRecords.searchRecords(CITI_MODULE, {
        word: q.search.trim(),
        fields: CITI_FIELDS,
        ...paging,
      });
      // Word search has no criteria AND — status filter applies client-side (widget parity).
      if (q.status) page.rows = page.rows.filter((r) => r.Status_of_App === q.status);
      return page;
    }
    if (q.status) {
      return zohoCrmRecords.searchRecords(CITI_MODULE, {
        criteria: `(Status_of_App:equals:${q.status})`,
        fields: CITI_FIELDS,
        ...paging,
      });
    }
    return zohoCrmRecords.listRecords(CITI_MODULE, CITI_FIELDS, {
      ...paging,
      sortBy: 'Created_Time',
      sortOrder: 'desc',
    });
  });

  /** Live picklist metadata (status tabs + modal picklists come from here). */
  app.get('/cs/citifuel/meta', guard, async (request) => {
    requireCsAccess(request);
    const [statusOptions, requestOptions, actionOptions] = await Promise.all([
      getPicklistValues(CITI_MODULE, 'Status_of_App'),
      getPicklistValues(CITI_MODULE, 'Request'),
      getPicklistValues(CITI_MODULE, 'Actions_taken'),
    ]);
    return { statusOptions, requestOptions, actionOptions };
  });

  /** Per-status counts + total (server-built COQL — parity with citigetstats). */
  app.get('/cs/citifuel/stats', guard, async (request) => {
    requireCsAccess(request);
    const statuses = await getPicklistValues(CITI_MODULE, 'Status_of_App');
    const count = async (where: string): Promise<number> => {
      const res = await zohoCrm.runCoql(`select COUNT(id) from ${CITI_MODULE} where ${where}`);
      const row = res.rows[0] ?? {};
      const value = row['COUNT(id)'] ?? row['count(id)'] ?? row['count'] ?? 0;
      return Number(value) || 0;
    };
    const total = await count('Created_Time is not null');
    const byStatus: Record<string, number> = {};
    for (const status of statuses) {
      byStatus[status] = await count(`Status_of_App = ${coqlLiteral(status)}`);
    }
    return { total, byStatus };
  });

  /** Accounts typeahead for the Company_Name lookup. */
  app.get('/cs/citifuel/lookup/accounts', guard, async (request) => {
    requireCsAccess(request);
    const { q } = z.object({ q: z.string().min(2).max(120) }).parse(request.query);
    const page = await zohoCrmRecords.searchRecords('Accounts', {
      word: q,
      fields: ['id', 'Account_Name'],
      perPage: 20,
    });
    return { accounts: page.rows };
  });

  /** Active CRM users for the Agent/Owner typeaheads. */
  app.get('/cs/citifuel/lookup/users', guard, async (request) => {
    requireCsAccess(request);
    const users = await zohoCrm.listActiveUsers();
    return { users: users.map((u) => ({ id: u.zohoUserId, name: u.name, email: u.email })) };
  });

  /** Create (workflow trigger kept for widget parity). */
  app.post('/cs/citifuel', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const data = pickEditable(writeBody.parse(request.body));
    const resolved = await resolveWritePayload(CITI_MODULE, data);
    const id = await zohoCrmRecords.insertRecord(CITI_MODULE, resolved, ['workflow']);
    await auditFromContext(ctx, {
      action: 'cs.citifuel.create',
      status: 'ok',
      resourceType: 'crm_citifuel_client',
      resourceId: id,
      detail: { fields: Object.keys(resolved), name: String(data.Name ?? '') },
    });
    return { id };
  });

  /** Update. */
  app.patch('/cs/citifuel/:id', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const { id } = idParam.parse(request.params);
    const data = pickEditable(writeBody.parse(request.body));
    const resolved = await resolveWritePayload(CITI_MODULE, data);
    await zohoCrmRecords.updateRecord(CITI_MODULE, id, resolved);
    await auditFromContext(ctx, {
      action: 'cs.citifuel.update',
      status: 'ok',
      resourceType: 'crm_citifuel_client',
      resourceId: id,
      detail: { fields: Object.keys(resolved) },
    });
    return { id };
  });

  /** Delete — audited with a snapshot of the identifying fields (real deletion). */
  app.delete('/cs/citifuel/:id', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const { id } = idParam.parse(request.params);
    const record = await zohoCrmRecords.getRecord(CITI_MODULE, id);
    await zohoCrmRecords.deleteRecord(CITI_MODULE, id);
    await auditFromContext(ctx, {
      action: 'cs.citifuel.delete',
      status: 'ok',
      resourceType: 'crm_citifuel_client',
      resourceId: id,
      detail: {
        snapshot: {
          name: record?.Name ?? null,
          appId: record?.App_ID ?? null,
          status: record?.Status_of_App ?? null,
        },
      },
    });
    return { id, deleted: true };
  });
}
