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

/** Report window — `YYYY-MM-DD` only, since these are interpolated into COQL date comparisons. */
const windowQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  })
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to' });

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
    const noNone = (values: string[]): string[] => values.filter((v) => v !== '-None-');
    const [statusOptions, requestOptions, actionOptions] = await Promise.all([
      getPicklistValues(CITI_MODULE, 'Status_of_App'),
      getPicklistValues(CITI_MODULE, 'Request'),
      getPicklistValues(CITI_MODULE, 'Actions_taken'),
    ]);
    return {
      statusOptions: noNone(statusOptions),
      requestOptions: noNone(requestOptions),
      actionOptions: noNone(actionOptions),
    };
  });

  /** Per-status counts + total (server-built COQL — parity with citigetstats). */
  app.get('/cs/citifuel/stats', guard, async (request) => {
    requireCsAccess(request);
    const statuses = (await getPicklistValues(CITI_MODULE, 'Status_of_App')).filter(
      (v) => v !== '-None-',
    );
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

  /**
   * Citi-vs-Octane split over a Date_of_Request window — QA feedback (2026-07-28): "pull a report
   * on how many clients were sent to Citi vs how many remained with Octane over any selected
   * period". One GROUP BY rather than the per-status N+1 the /stats route above does.
   *
   * COQL notes: a WHERE clause is mandatory, and AND is binary — the two date bounds are one
   * parenthesised pair. Records with no Date_of_Request cannot fall in a window and are excluded,
   * which is why `total` is the window's own sum and not the module total.
   */
  app.get('/cs/citifuel/decision-split', guard, async (request) => {
    requireCsAccess(request);
    const q = windowQuery.parse(request.query);
    const res = await zohoCrm.runCoql(
      `select Final_Decision, COUNT(id) from ${CITI_MODULE} ` +
        `where (Date_of_Request >= ${coqlLiteral(q.from)} and Date_of_Request <= ${coqlLiteral(q.to)}) ` +
        `group by Final_Decision`,
    );
    const byDecision = res.rows.map((r) => ({
      decision: String(r['Final_Decision'] ?? '') || 'Undecided',
      count: Number(r['COUNT(id)'] ?? r['count(id)'] ?? 0) || 0,
    }));
    // Bucket generously — a renamed picklist value should still land somewhere sensible rather
    // than silently dropping out of the report.
    let citifuel = 0;
    let octane = 0;
    let undecided = 0;
    for (const d of byDecision) {
      const s = d.decision.trim().toLowerCase();
      if (s.includes('citi')) citifuel += d.count;
      else if (s.includes('octane')) octane += d.count;
      else undecided += d.count;
    }
    return {
      from: q.from,
      to: q.to,
      total: citifuel + octane + undecided,
      citifuel,
      octane,
      undecided,
      byDecision,
    };
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
