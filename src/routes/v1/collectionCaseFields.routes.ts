/**
 * The rest of the Zoho `Collection_Cases` surface: the field blocks a collector edits by hand,
 * who owns the case, and the follow-ups they set for themselves.
 *
 * Split out of `collectionActions.routes.ts` because that file holds the LIFECYCLE moves — stage,
 * close, reopen, placement, promises, plans — each of which has side effects and a timeline
 * entry of its own. What is here is flatter: a patch, an assignment, a task. Keeping them apart
 * also keeps both files inside the size cap.
 *
 * Every write lands in `collection_activity` as well as the audit log. The timeline is what a
 * collector reads; the audit log is what an auditor reads, and they want different things.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AGENCY_RESPONSE_STATUSES,
  CAINE_WEINER_TIERS,
  COLLECTION_AGENCIES,
  COLLECTION_LOSS_REASONS,
  COOPERATION_STATUSES,
  COURT_STATUSES,
  COURT_TYPES,
} from '../../db/schema/collection.js';
import { COLLECTION_TASK_PRIORITIES, COLLECTION_TASK_STATUSES } from '../../db/schema/collection_tasks.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { collectionActivityRepo } from '../../repos/collectionActivityRepo.js';
import {
  changedFields,
  collectionCaseFieldsRepo,
  type CaseFieldPatch,
} from '../../repos/collectionCaseFieldsRepo.js';
import { collectionCaseRepo } from '../../repos/collectionCaseRepo.js';
import { collectionTaskRepo } from '../../repos/collectionTaskRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const idParams = z.object({ id: z.string().min(1).max(80) });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'must be a positive amount');
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * One patch shape for every editable block rather than an endpoint each. The blocks are edited
 * from one form on the case record and a collector saves once; five endpoints would mean five
 * round trips, five audit lines, and a half-saved record if the third one failed.
 */
const fieldsBody = z.object({
  currentAgency: z.enum(COLLECTION_AGENCIES).nullable().optional(),
  secondCollectionAgency: z.enum(COLLECTION_AGENCIES).nullable().optional(),
  caineWeinerTier: z.enum(CAINE_WEINER_TIERS).nullable().optional(),
  agencyResponseStatus: z.enum(AGENCY_RESPONSE_STATUSES).nullable().optional(),
  agencyTransferDate: ymd.nullable().optional(),

  legalActionRequired: z.boolean().optional(),
  courtType: z.enum(COURT_TYPES).nullable().optional(),
  legalFilingDate: ymd.nullable().optional(),
  legalDocumentsAttached: z.boolean().optional(),
  courtStatus: z.enum(COURT_STATUSES).nullable().optional(),

  skipTraceRequired: z.boolean().optional(),
  verifiedEmail: z.string().trim().email().max(200).nullable().optional(),
  verifiedPhone: nullableText(40),
  verifiedAddress: nullableText(400),

  escalationRequired: z.boolean().optional(),
  escalationDate: ymd.nullable().optional(),

  cooperationStatus: z.enum(COOPERATION_STATUSES).nullable().optional(),
  lossReason: z.enum(COLLECTION_LOSS_REASONS).nullable().optional(),
  paymentReceived: z.boolean().optional(),
  paymentReceivedDate: ymd.nullable().optional(),

  reminderCycleActive: z.boolean().optional(),
  earlyBadDebtorFlag: z.boolean().optional(),
  totalCostIncurred: money.optional(),

  note: z.string().trim().max(2000).optional(),
});

/**
 * Both fields optional: "assign to me" is the overwhelmingly common case, and making the client
 * send its own id invites an id-format mismatch between what the session stores and what the
 * token carries. Omit them and the caller takes the case.
 */
const assignBody = z.object({
  userId: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().max(160).nullable().optional(),
});

const taskBody = z.object({
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).nullable().optional(),
  dueDate: ymd,
  priority: z.enum(COLLECTION_TASK_PRIORITIES).optional(),
  assigneeUserId: z.string().trim().max(80).nullable().optional(),
  assigneeName: z.string().trim().max(160).nullable().optional(),
});

const taskPatchBody = taskBody.partial().extend({
  status: z.enum(COLLECTION_TASK_STATUSES).optional(),
});

function requireCollectionWrite(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'collection', 'Collection desk');
}

function actor(ctx: TenantContext) {
  return {
    ...(ctx.userId !== undefined ? { actorUserId: ctx.userId } : {}),
    ...(ctx.userName !== undefined ? { actorName: ctx.userName } : {}),
  };
}

/** Human wording for the timeline. "3 fields updated" tells a reader nothing worth reading. */
const FIELD_LABEL: Record<string, string> = {
  currentAgency: 'current agency',
  secondCollectionAgency: 'second agency',
  caineWeinerTier: 'Caine & Weiner tier',
  agencyResponseStatus: 'agency response',
  agencyTransferDate: 'agency transfer date',
  legalActionRequired: 'legal action flag',
  courtType: 'court',
  legalFilingDate: 'filing date',
  legalDocumentsAttached: 'legal documents flag',
  courtStatus: 'court status',
  skipTraceRequired: 'skip trace flag',
  verifiedEmail: 'verified email',
  verifiedPhone: 'verified phone',
  verifiedAddress: 'verified address',
  escalationRequired: 'escalation flag',
  escalationDate: 'escalation date',
  cooperationStatus: 'cooperation',
  lossReason: 'loss reason',
  paymentReceived: 'payment received flag',
  paymentReceivedDate: 'payment received date',
  reminderCycleActive: 'reminder cycle',
  earlyBadDebtorFlag: 'early bad debtor flag',
  totalCostIncurred: 'cost incurred',
};

export async function collectionCaseFieldRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  async function requireCase(request: FastifyRequest, id: string) {
    const ctx = requireCollectionWrite(request);
    const row = await collectionCaseRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Collection case not found');
    return { ctx, row };
  }

  /** Edit the hand-maintained field blocks. An empty patch is a no-op, not an error. */
  app.patch<{ Params: { id: string } }>('/collection/cases/:id/fields', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const { ctx } = await requireCase(request, id);
    const { note, ...patch } = fieldsBody.parse(request.body);
    const changed = changedFields(patch as CaseFieldPatch);
    const updated = await collectionCaseFieldsRepo.patch(id, patch as CaseFieldPatch);
    if (!updated) throw new NotFoundError('Collection case not found');
    if (changed.length === 0) return { case: updated };

    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'note',
      summary: `Updated ${changed.map((k) => FIELD_LABEL[k] ?? k).join(', ')}`,
      ...(note !== undefined ? { note } : {}),
      meta: { fields: changed },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.fields.patch',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { fields: changed },
    });
    return { case: updated };
  });

  /** Give the case to a collector. */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/assignee', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const { ctx, row } = await requireCase(request, id);
    const body = assignBody.parse(request.body ?? {});
    const userId = body.userId ?? ctx.userId;
    if (!userId) throw new ValidationError('No user to assign this case to');
    const name = body.userId ? (body.name ?? null) : (body.name ?? ctx.userName ?? null);
    const updated = await collectionCaseFieldsRepo.assign(id, { userId, name });
    if (!updated) throw new NotFoundError('Collection case not found');
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'note',
      summary: row.assigneeUserId
        ? `Reassigned to ${name ?? userId}`
        : `Assigned to ${name ?? userId}`,
      meta: { from: row.assigneeUserId, to: userId },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.assignee.set',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { from: row.assigneeUserId, to: userId },
    });
    return { case: updated };
  });

  /** Put the case back in the unassigned pool. */
  app.delete<{ Params: { id: string } }>('/collection/cases/:id/assignee', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const { ctx, row } = await requireCase(request, id);
    const updated = await collectionCaseFieldsRepo.unassign(id);
    if (!updated) throw new NotFoundError('Collection case not found');
    if (row.assigneeUserId) {
      await collectionActivityRepo.insert({
        caseId: id,
        kind: 'note',
        summary: `Unassigned from ${row.assigneeName ?? row.assigneeUserId}`,
        meta: { from: row.assigneeUserId },
        ...actor(ctx),
      });
    }
    await auditFromContext(ctx, {
      action: 'collection.assignee.clear',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { from: row.assigneeUserId },
    });
    return { case: updated };
  });

  app.get<{ Params: { id: string } }>('/collection/cases/:id/tasks', auth, async (request) => {
    const ctx = requireDepartment(request, 'collection', 'Collection desk');
    const { id } = idParams.parse(request.params);
    const row = await collectionCaseRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Collection case not found');
    return { items: await collectionTaskRepo.listByCase(ctx, row.id) };
  });

  app.post<{ Params: { id: string } }>('/collection/cases/:id/tasks', auth, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { ctx } = await requireCase(request, id);
    const body = taskBody.parse(request.body);
    const task = await collectionTaskRepo.create({
      caseId: id,
      title: body.title,
      note: body.note ?? null,
      dueDate: body.dueDate,
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      assigneeUserId: body.assigneeUserId ?? ctx.userId ?? null,
      assigneeName: body.assigneeName ?? ctx.userName ?? null,
      createdById: ctx.userId ?? null,
      createdByName: ctx.userName ?? null,
    });
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'note',
      summary: `Follow-up set for ${body.dueDate}: ${body.title}`,
      meta: { taskId: task.id, dueDate: body.dueDate },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.task.create',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { taskId: task.id, dueDate: body.dueDate },
    });
    return reply.code(201).send({ task });
  });

  /** Reschedule, re-word, reassign or resolve a follow-up. */
  app.patch<{ Params: { id: string } }>('/collection/tasks/:id', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const ctx = requireCollectionWrite(request);
    const existing = await collectionTaskRepo.findById(id);
    if (!existing) throw new NotFoundError('Follow-up not found');
    // The task hangs off a case, so tenant visibility is decided by the CASE, not the task row.
    const owner = await collectionCaseRepo.findById(ctx, existing.caseId);
    if (!owner) throw new NotFoundError('Follow-up not found');

    const body = taskPatchBody.parse(request.body);
    if (Object.keys(body).length === 0) throw new ValidationError('Nothing to change');
    // Built key by key rather than spread: `exactOptionalPropertyTypes` is on, so an explicit
    // `title: undefined` in the spread is not the same as omitting it.
    const task = await collectionTaskRepo.update(id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.assigneeUserId !== undefined ? { assigneeUserId: body.assigneeUserId } : {}),
      ...(body.assigneeName !== undefined ? { assigneeName: body.assigneeName } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.status !== undefined && body.status !== 'open'
        ? { completedById: ctx.userId ?? null }
        : {}),
    });
    if (!task) throw new NotFoundError('Follow-up not found');

    if (body.status !== undefined && body.status !== existing.status) {
      await collectionActivityRepo.insert({
        caseId: existing.caseId,
        kind: 'note',
        summary:
          body.status === 'done'
            ? `Follow-up done: ${task.title}`
            : body.status === 'cancelled'
              ? `Follow-up cancelled: ${task.title}`
              : `Follow-up reopened: ${task.title}`,
        meta: { taskId: id, status: body.status },
        ...actor(ctx),
      });
    }
    await auditFromContext(ctx, {
      action: 'collection.task.update',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: existing.caseId,
      detail: { taskId: id, fields: Object.keys(body) },
    });
    return { task };
  });
}
