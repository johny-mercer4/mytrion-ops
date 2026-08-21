/**
 * Collection desk — the WRITE side. Everything a collector does that changes the world.
 *
 * ⚠ TWO KINDS OF WRITE LIVE HERE, and the difference matters at review time:
 *
 *   OURS      `collection_activity`, `collection_promises`, `collection_payment_plans`,
 *             `collection_plan_instalments`. Nothing outside this app writes these.
 *   FINDER'S  three columns on `collection_cases` — `collection_stage`, `status`/`closed_*`,
 *             `placement_date`. The upsert job owns that table and may overwrite what we set.
 *             See the note on `collectionCaseRepo.setStage`. Every such write is mirrored into
 *             `collection_activity` so the human decision survives a clobber.
 *
 * Every endpoint is COLLECTION-gated, audit-logged through `auditFromContext`, and appends to the
 * timeline. There is no DELETE on any of it: a desk record that can be erased is not a record.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CAINE_WEINER_TIERS,
  COLLECTION_AGENCIES,
  COLLECTION_CLOSED_REASONS,
  COLLECTION_STAGES,
} from '../../db/schema/collection.js';
import {
  COLLECTION_CONTACT_CHANNELS,
  COLLECTION_CONTACT_OUTCOMES,
  COLLECTION_INSTALMENT_STATUSES,
  COLLECTION_PLAN_FREQUENCIES,
} from '../../db/schema/collection_desk.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  closeSummary,
  contactSummary,
  planSummary,
  stageSummary,
} from '../../modules/collection/deskSummaries.js';
import {
  canTransition,
  transitionFor,
  transitionsFrom,
} from '../../modules/collection/stageGraph.js';
import { collectionActivityRepo } from '../../repos/collectionActivityRepo.js';
import { collectionCaseRepo } from '../../repos/collectionCaseRepo.js';
import { collectionPlanRepo } from '../../repos/collectionPlanRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireCollectionWrite(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'collection', 'Collection desk');
}

const idParams = z.object({ id: z.string().min(1).max(80) });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
/** Money as a decimal string — never a float. Numerics leave Postgres as strings for a reason. */
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'must be a positive amount');

const contactBody = z.object({
  channel: z.enum(COLLECTION_CONTACT_CHANNELS),
  outcome: z.enum(COLLECTION_CONTACT_OUTCOMES),
  note: z.string().trim().max(4000).optional(),
  contactName: z.string().trim().max(160).optional(),
  occurredAt: z.string().datetime().optional(),
  /** A promise taken on the same call — one action for the collector, two rows here. */
  promise: z.object({ amount: money, dueDate: ymd }).optional(),
});

const promiseBody = z.object({
  amount: money,
  dueDate: ymd,
  note: z.string().trim().max(1000).optional(),
});

const planBody = z.object({
  instalmentAmount: money,
  instalmentCount: z.coerce.number().int().min(1).max(60),
  frequency: z.enum(COLLECTION_PLAN_FREQUENCIES),
  firstPaymentDate: ymd,
  note: z.string().trim().max(1000).optional(),
});

const stageBody = z.object({
  stage: z.enum(COLLECTION_STAGES),
  note: z.string().trim().max(1000).optional(),
});

const placementBody = z.object({
  agency: z.enum(COLLECTION_AGENCIES),
  placementDate: ymd,
  /** Only Caine & Weiner grade the work; ignored for every other agency. */
  tier: z.enum(CAINE_WEINER_TIERS).optional(),
  note: z.string().trim().max(1000).optional(),
});

const closeBody = z.object({
  reason: z.enum(COLLECTION_CLOSED_REASONS),
  writeOffAmount: money.optional(),
  note: z.string().trim().max(4000).optional(),
});

const noteBody = z.object({ note: z.string().trim().min(1).max(4000) });

const instalmentBody = z.object({ status: z.enum(COLLECTION_INSTALMENT_STATUSES) });

/** Actor fields, spread onto every insert so a timeline entry always names who did it. */
function actor(ctx: TenantContext) {
  return {
    ...(ctx.userId !== undefined ? { actorUserId: ctx.userId } : {}),
    ...(ctx.userName !== undefined ? { actorName: ctx.userName } : {}),
  };
}

export async function collectionActionRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  /** The case must exist AND be visible to this tenant before anything is written to it. */
  async function requireCase(request: FastifyRequest, id: string) {
    const ctx = requireCollectionWrite(request);
    const row = await collectionCaseRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Collection case not found');
    return { ctx, row };
  }

  /** Log a contact attempt, optionally with the promise the debtor made on it. */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/contact', auth, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { ctx } = await requireCase(request, id);
    const body = contactBody.parse(request.body);

    const entry = await collectionActivityRepo.insert({
      caseId: id,
      kind: 'contact',
      channel: body.channel,
      outcome: body.outcome,
      summary: contactSummary(body.channel, body.outcome),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
      ...(body.occurredAt !== undefined ? { occurredAt: new Date(body.occurredAt) } : {}),
      ...actor(ctx),
    });

    let promise = null;
    if (body.promise) {
      promise = await collectionPlanRepo.createPromise({
        caseId: id,
        amount: body.promise.amount,
        dueDate: body.promise.dueDate,
        ...(ctx.userId !== undefined ? { createdByUserId: ctx.userId } : {}),
        ...(ctx.userName !== undefined ? { createdByName: ctx.userName } : {}),
      });
      await collectionActivityRepo.insert({
        caseId: id,
        kind: 'promise',
        summary: `Promised $${body.promise.amount} by ${body.promise.dueDate}`,
        amount: body.promise.amount,
        meta: { promiseId: promise.id, dueDate: body.promise.dueDate },
        ...actor(ctx),
      });
    }

    await auditFromContext(ctx, {
      action: 'collection.contact.log',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { channel: body.channel, outcome: body.outcome, withPromise: Boolean(body.promise) },
    });
    return reply.code(201).send({ activity: entry, promise });
  });

  /** A promise taken outside a call — a payment portal commitment, an email reply. */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/promises', auth, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { ctx } = await requireCase(request, id);
    const body = promiseBody.parse(request.body);
    const promise = await collectionPlanRepo.createPromise({
      caseId: id,
      amount: body.amount,
      dueDate: body.dueDate,
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(ctx.userId !== undefined ? { createdByUserId: ctx.userId } : {}),
      ...(ctx.userName !== undefined ? { createdByName: ctx.userName } : {}),
    });
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'promise',
      summary: `Promised $${body.amount} by ${body.dueDate}`,
      amount: body.amount,
      ...(body.note !== undefined ? { note: body.note } : {}),
      meta: { promiseId: promise.id, dueDate: body.dueDate },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.promise.create',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { amount: body.amount, dueDate: body.dueDate },
    });
    return reply.code(201).send({ promise });
  });

  /**
   * Start or revise a payment plan. Revising closes the running plan inside one transaction —
   * see `collectionPlanRepo.createPlan`. The case moves to `payment_plan` in the same call
   * because a plan that leaves the stage behind is a plan the board cannot show.
   */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/plan', auth, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { ctx, row } = await requireCase(request, id);
    if (row.status === 'closed') {
      throw new ValidationError('This case is closed — reopen it before starting a plan');
    }
    const body = planBody.parse(request.body);
    const plan = await collectionPlanRepo.createPlan({
      caseId: id,
      instalmentAmount: body.instalmentAmount,
      instalmentCount: body.instalmentCount,
      frequency: body.frequency,
      firstPaymentDate: body.firstPaymentDate,
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(ctx.userId !== undefined ? { createdByUserId: ctx.userId } : {}),
      ...(ctx.userName !== undefined ? { createdByName: ctx.userName } : {}),
    });
    if (row.collectionStage !== 'payment_plan') {
      await collectionCaseRepo.setStage(id, 'payment_plan');
      await collectionActivityRepo.insert({
        caseId: id,
        kind: 'stage',
        summary: stageSummary(row.collectionStage, 'payment_plan'),
        meta: { from: row.collectionStage, to: 'payment_plan', planId: plan.id },
        ...actor(ctx),
      });
    }
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'plan',
      summary: planSummary(body.instalmentAmount, body.instalmentCount, body.frequency),
      amount: body.instalmentAmount,
      ...(body.note !== undefined ? { note: body.note } : {}),
      meta: { planId: plan.id, supersedes: plan.supersedesPlanId },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.plan.create',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { planId: plan.id, count: body.instalmentCount, frequency: body.frequency },
    });
    return reply.code(201).send({ plan });
  });

  /** Move the case along the eight-stage spine. */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/stage', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const { ctx, row } = await requireCase(request, id);
    const body = stageBody.parse(request.body);
    // A self-edge is a real move on With Agency ("pick next agency"), so an unchanged stage is
    // only a no-op when the Blueprint has no self-edge to justify it.
    if (body.stage === row.collectionStage && !canTransition(row.collectionStage, body.stage)) {
      return { case: row };
    }
    // THE BLUEPRINT IS THE RULE. Zoho would not let a collector jump Intake straight to With
    // Agency, and neither does this. Rejecting here rather than in the UI matters because the
    // desk is not the only caller — the API is what servercrm and any future automation reach.
    const transition = transitionFor(row.collectionStage, body.stage);
    if (!transition) {
      const allowed = transitionsFrom(row.collectionStage)
        .map((t) => t.to)
        .join(', ');
      throw new ValidationError(
        `A case on ${row.collectionStage} cannot move to ${body.stage}. Allowed from here: ${allowed || 'nothing'}.`,
      );
    }
    const updated = await collectionCaseRepo.setStage(id, body.stage);
    if (!updated) throw new NotFoundError('Collection case not found');
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'stage',
      // The Blueprint's own wording for the move, which is what a collector recognises, with the
      // plain from/to underneath for anyone reading the timeline cold.
      summary: `${transition.label} — ${stageSummary(row.collectionStage, body.stage)}`,
      ...(body.note !== undefined ? { note: body.note } : {}),
      meta: { from: row.collectionStage, to: body.stage, transition: transition.label },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.stage.set',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { from: row.collectionStage, to: body.stage },
    });
    return { case: updated };
  });

  /**
   * Record a placement with a collection agency.
   *
   * This does NOT transmit anything to Array. Array is filed monthly by the existing 6-hour Zoho
   * cron and this app has no integration with it; what this endpoint does is mark the case as
   * placed so the queue stops offering it and the board moves it to Agency. Wiring the actual
   * filing is a separate piece of work.
   */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/placement', auth, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { ctx, row } = await requireCase(request, id);
    const body = placementBody.parse(request.body);
    // RE-PLACEMENT IS ALLOWED, to a DIFFERENT agency. The Blueprint's "120 days · no payment →
    // pick next agency" self-edge is exactly this move, and refusing it outright (as this used
    // to) left the desk unable to represent a case that had been through two agencies. Placing
    // twice with the same agency is still a mistake, so that one is refused.
    if (row.placementDate && row.currentAgency === body.agency) {
      throw new ValidationError(`This case is already placed with ${body.agency}`);
    }
    const updated = await collectionCaseRepo.markPlaced(id, {
      placementDate: body.placementDate,
      agency: body.agency,
      tier: body.tier ?? null,
    });
    if (!updated) throw new NotFoundError('Collection case not found');
    await collectionPlanRepo
      .activePlan(ctx, id)
      .then((plan) => (plan ? collectionPlanRepo.closePlan(plan.id, 'cancelled') : undefined));
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'agency',
      summary: row.placementDate
        ? `Moved to ${body.agency} from ${row.currentAgency ?? 'the previous agency'}`
        : `Placed with ${body.agency}`,
      ...(body.note !== undefined ? { note: body.note } : {}),
      meta: { agency: body.agency, placementDate: body.placementDate },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.placement.create',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { agency: body.agency, placementDate: body.placementDate },
    });
    return reply.code(201).send({ case: updated });
  });

  /** Close the case. `case_lost` also moves the stage; every other reason resolves it clean. */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/close', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const { ctx, row } = await requireCase(request, id);
    if (row.status === 'closed') throw new ValidationError('This case is already closed');
    const body = closeBody.parse(request.body);
    const stage = body.reason === 'case_lost' ? 'case_lost' : 'closed_successfully';
    const updated = await collectionCaseRepo.close(id, { reason: body.reason, stage });
    if (!updated) throw new NotFoundError('Collection case not found');
    const plan = await collectionPlanRepo.activePlan(ctx, id);
    if (plan) await collectionPlanRepo.closePlan(plan.id, body.reason === 'paid_in_full' ? 'completed' : 'cancelled');
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'close',
      summary: closeSummary(body.reason),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.writeOffAmount !== undefined ? { amount: body.writeOffAmount } : {}),
      meta: { reason: body.reason, stage },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.case.close',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { reason: body.reason, writeOff: body.writeOffAmount ?? null },
    });
    return { case: updated };
  });

  /** Reopen a closed case. Increments the finder's own `reopen_count`. */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/reopen', auth, async (request) => {
    const { id } = idParams.parse(request.params);
    const { ctx, row } = await requireCase(request, id);
    if (row.status === 'open') throw new ValidationError('This case is already open');
    const updated = await collectionCaseRepo.reopen(id);
    if (!updated) throw new NotFoundError('Collection case not found');
    await collectionActivityRepo.insert({
      caseId: id,
      kind: 'stage',
      summary: 'Case reopened',
      meta: { from: 'closed', to: 'open' },
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.case.reopen',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: { previousReason: row.closedReason },
    });
    return { case: updated };
  });

  /** A plain note on the record. */
  app.post<{ Params: { id: string } }>('/collection/cases/:id/notes', auth, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { ctx } = await requireCase(request, id);
    const body = noteBody.parse(request.body);
    const entry = await collectionActivityRepo.insert({
      caseId: id,
      kind: 'note',
      summary: 'Note',
      note: body.note,
      ...actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'collection.note.create',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: id,
      detail: {},
    });
    return reply.code(201).send({ activity: entry });
  });

  /**
   * Mark an instalment paid or missed by hand.
   *
   * Payments are not yet reconciled against CMP here — when they are, this becomes the manual
   * override rather than the only path. Marking one paid also settles the case's open promise,
   * because a collector who takes the money has kept the promise they took it against.
   */
  app.patch<{ Params: { id: string } }>('/collection/cases/:id/instalments/:seq', auth, async (request) => {
    const params = idParams.extend({ seq: z.coerce.number().int().min(1).max(60) }).parse(request.params);
    const { ctx } = await requireCase(request, params.id);
    const body = instalmentBody.parse(request.body);
    const plan = await collectionPlanRepo.activePlan(ctx, params.id);
    const instalment = plan?.instalments.find((i) => i.seq === params.seq);
    if (!plan || !instalment) throw new NotFoundError('Instalment not found on the active plan');
    await collectionPlanRepo.setInstalmentStatus(instalment.id, body.status);
    if (body.status === 'paid') {
      await collectionActivityRepo.insert({
        caseId: params.id,
        kind: 'payment',
        summary: `Instalment ${instalment.seq} of ${plan.instalmentCount} paid`,
        amount: instalment.amount,
        meta: { planId: plan.id, seq: instalment.seq },
        ...actor(ctx),
      });
    }
    await auditFromContext(ctx, {
      action: 'collection.instalment.set',
      status: 'ok',
      resourceType: 'collection_case',
      resourceId: params.id,
      detail: { planId: plan.id, seq: instalment.seq, status: body.status },
    });
    return { plan: await collectionPlanRepo.activePlan(ctx, params.id) };
  });
}
