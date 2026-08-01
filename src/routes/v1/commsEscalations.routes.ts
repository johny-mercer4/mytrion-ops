/**
 * Native escalations (/v1/comms/escalations) — the Zoho Desk / `createescalationticket` Deluge replacement.
 *
 * An escalation is a REQUEST TO ANOTHER PERSON, not a ticket about a client: it carries no carrier and no
 * company (enforced by `mytrion_tickets_escalation_personal_chk`), and its whole ladder — requester,
 * level-2 agent, department manager, C-Level — talks in ONE thread that only grows. Conversation therefore
 * lives on `/v1/comms/threads/:id/messages` exactly as it does for a ticket, and there is no escalation-
 * specific message route.
 *
 * Every assignee at every level comes from admin config resolved at that moment and snapshotted onto the
 * hop, so `/v1/comms/admin/routing` is what makes any of this reachable. An unconfigured reason is refused
 * with a message naming that screen, rather than parked in nobody's inbox.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { readerOf, toThreadDto } from '../../modules/comms/dto.js';
import { loadChain, raiseEscalation } from '../../modules/comms/escalationService.js';
import {
  closeEscalation,
  escalateUp,
  handOffEscalation,
  withdrawEscalation,
} from '../../modules/comms/escalationTransitions.js';
import { commsEscalationRepo } from '../../repos/commsEscalationRepo.js';
import { requireInternal } from './helpers.js';
import type { MytrionEscalation, MytrionEscalationHop } from '../../db/schema/index.js';

const createBody = z.object({
  /** Escalation reason code (ESC-01 …). Categorises the request, and can name a fall-to user. */
  reasonCode: z.string().min(1).max(60),
  /**
   * WHICH DEPARTMENT the request is aimed at, chosen when it is opened. This is the primary routing input:
   * level 2 is that department's own agent. A slug, because that is the routing key — the UI picks from our
   * hr_departments list and sends the slug its routing row is keyed on.
   */
  targetDepartment: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/, 'lowercase department slug')
    .optional(),
  subject: z.string().min(1).max(300),
  description: z.string().min(1).max(8000),
  sourceMytrion: z.string().max(60).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

/** Every transition carries the version it saw, so a stale decision 409s instead of overwriting. */
const decisionBody = z.object({
  expectedVersion: z.number().int().min(1),
  comment: z.string().max(4000).optional(),
});

const escalateUpBody = decisionBody.extend({
  /** Required only to reach level 4 — which C-Level member. Validated against the `c-level` pool. */
  toZohoUserId: z.string().regex(/^\d+$/).max(60).optional(),
});

const handOffBody = decisionBody.extend({
  toDepartment: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/, 'lowercase department slug'),
  toZohoUserId: z.string().regex(/^\d+$/).max(60).optional(),
});

const listQuery = z.object({
  status: z.string().max(120).optional(),
  /** 'mine' = raised by me · 'inbox' = waiting on me. Both narrow inside the reader filter. */
  scope: z.enum(['mine', 'inbox', 'all']).optional(),
  department: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const STATUSES = ['pending', 'resolved', 'rejected', 'withdrawn', 'expired'] as const;

function toEscalationDto(row: MytrionEscalation): Record<string, unknown> {
  return {
    id: row.id,
    threadId: row.threadId,
    ticketId: row.ticketId,
    reasonCode: row.reasonCode,
    reasonLabel: row.reasonLabel,
    requester: {
      zohoUserId: row.requesterZohoUserId,
      name: row.requesterName,
      department: row.requesterDepartment,
    },
    status: row.status,
    level: row.currentLevel,
    hopIndex: row.currentHopIndex,
    department: row.currentDepartment,
    assignee: row.currentAssigneeZohoUserId
      ? { zohoUserId: row.currentAssigneeZohoUserId, name: row.currentAssigneeName }
      : null,
    hopDueAt: row.hopDueAt?.toISOString() ?? null,
    resolution: row.resolutionComment,
    resolvedBy: row.resolvedByZohoUserId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    /** Echo back on the next transition. */
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One hop of the ladder. `skipReason` is deliberately exposed: a gap in the chain must be visible. */
function toHopDto(row: MytrionEscalationHop): Record<string, unknown> {
  return {
    hopIndex: row.hopIndex,
    level: row.level,
    levelLabel: row.levelLabel,
    department: row.department,
    assignee: row.assigneeZohoUserId
      ? { zohoUserId: row.assigneeZohoUserId, name: row.assigneeName }
      : null,
    routingSource: row.routingSource,
    skipReason: row.skipReason,
    handoffNote: row.handoffNote,
    decidedBy: row.decidedByZohoUserId,
    decision: row.decision,
    status: row.status,
    decisionComment: row.decisionComment,
    dueAt: row.dueAt?.toISOString() ?? null,
    openedAt: row.openedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}

export async function commsEscalationsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * Raise an escalation.
   *
   * Internal-only with NO department requirement, unlike ticket create: anyone in the company can escalate,
   * which is the whole point — a Sales agent, a CS agent and a department head all use this one route.
   */
  app.post('/comms/escalations', guard, async (request, reply) => {
    const ctx = requireInternal(request, 'Escalations');
    const body = createBody.parse(request.body);

    const { escalation, created } = await raiseEscalation(ctx, {
      reasonCode: body.reasonCode,
      targetDepartment: body.targetDepartment,
      subject: body.subject,
      description: body.description,
      sourceMytrion: body.sourceMytrion,
      idempotencyKey: body.idempotencyKey,
    });

    await auditFromContext(ctx, {
      action: 'comms.escalation.create',
      status: 'ok',
      resourceType: 'comms_escalation',
      resourceId: escalation.id,
      detail: {
        number: created.ticket.number,
        reasonCode: escalation.reasonCode,
        level: escalation.currentLevel,
        assignee: escalation.currentAssigneeZohoUserId,
        department: escalation.currentDepartment,
        replay: !created.created,
      },
    });

    return reply.code(created.created ? 201 : 200).send({
      escalation: toEscalationDto(escalation),
      number: created.ticket.number,
      threadId: created.thread.id,
      created: created.created,
    });
  });

  /** The caller's readable escalations. `scope` narrows inside the reader filter, never widens it. */
  app.get('/comms/escalations', guard, async (request) => {
    const ctx = requireInternal(request, 'Escalations');
    const q = listQuery.parse(request.query);
    const reader = readerOf(ctx);

    const wanted = new Set((q.status ?? '').split(',').map((s) => s.trim().toLowerCase()));
    const statuses = STATUSES.filter((s) => wanted.has(s));

    const rows = await commsEscalationRepo.list(ctx, {
      ...(statuses.length > 0 ? { status: statuses } : {}),
      ...(q.department ? { currentDepartment: q.department } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.scope === 'mine' && reader.actorZohoUserId
        ? { requesterZohoUserId: reader.actorZohoUserId }
        : {}),
      ...(q.scope === 'inbox' && reader.actorZohoUserId
        ? { currentAssigneeZohoUserId: reader.actorZohoUserId }
        : {}),
    });

    return { escalations: rows.map(toEscalationDto) };
  });

  /** One escalation plus its full ladder. 404 when unreadable, so a guessed id is not confirmed. */
  app.get('/comms/escalations/:id', guard, async (request) => {
    const ctx = requireInternal(request, 'Escalations');
    const { id } = request.params as { id: string };
    const chain = await loadChain(ctx, id);
    return {
      escalation: toEscalationDto(chain.escalation),
      hops: chain.hops.map(toHopDto),
      thread: chain.thread ? toThreadDto(chain.thread) : null,
    };
  });

  /** Escalate UP: agent → department manager → C-Level (which needs an explicit `toZohoUserId`). */
  app.post('/comms/escalations/:id/escalate', guard, async (request) => {
    const ctx = requireInternal(request, 'Escalations');
    const { id } = request.params as { id: string };
    const body = escalateUpBody.parse(request.body);

    const moved = await escalateUp(ctx, {
      escalationId: id,
      expectedVersion: body.expectedVersion,
      comment: body.comment,
      toZohoUserId: body.toZohoUserId,
    });

    await auditFromContext(ctx, {
      action: 'comms.escalation.escalate',
      status: 'ok',
      resourceType: 'comms_escalation',
      resourceId: id,
      detail: {
        toLevel: moved.currentLevel,
        assignee: moved.currentAssigneeZohoUserId,
        department: moved.currentDepartment,
      },
    });
    return { escalation: toEscalationDto(moved) };
  });

  /** Hand off SIDEWAYS to another department, re-entering at its agent level. */
  app.post('/comms/escalations/:id/handoff', guard, async (request) => {
    const ctx = requireInternal(request, 'Escalations');
    const { id } = request.params as { id: string };
    const body = handOffBody.parse(request.body);

    const moved = await handOffEscalation(ctx, {
      escalationId: id,
      expectedVersion: body.expectedVersion,
      toDepartment: body.toDepartment,
      toZohoUserId: body.toZohoUserId,
      note: body.comment,
    });

    await auditFromContext(ctx, {
      action: 'comms.escalation.handoff',
      status: 'ok',
      resourceType: 'comms_escalation',
      resourceId: id,
      detail: {
        toDepartment: moved.currentDepartment,
        assignee: moved.currentAssigneeZohoUserId,
      },
    });
    return { escalation: toEscalationDto(moved) };
  });

  /** Resolve or reject — terminal, and only from the person it currently sits with. */
  for (const outcome of ['resolve', 'reject'] as const) {
    app.post(`/comms/escalations/:id/${outcome}`, guard, async (request) => {
      const ctx = requireInternal(request, 'Escalations');
      const { id } = request.params as { id: string };
      const body = decisionBody.parse(request.body);

      const closed = await closeEscalation(ctx, outcome === 'resolve' ? 'resolved' : 'rejected', {
        escalationId: id,
        expectedVersion: body.expectedVersion,
        comment: body.comment,
      });

      await auditFromContext(ctx, {
        action: `comms.escalation.${outcome}`,
        status: 'ok',
        resourceType: 'comms_escalation',
        resourceId: id,
        detail: { level: closed.currentLevel, hasComment: Boolean(body.comment) },
      });
      return { escalation: toEscalationDto(closed) };
    });
  }

  /** Withdraw — the requester's own cancel, wherever the escalation currently sits. */
  app.post('/comms/escalations/:id/withdraw', guard, async (request) => {
    const ctx = requireInternal(request, 'Escalations');
    const { id } = request.params as { id: string };
    const body = decisionBody.parse(request.body);

    const closed = await withdrawEscalation(ctx, {
      escalationId: id,
      expectedVersion: body.expectedVersion,
      comment: body.comment,
    });

    await auditFromContext(ctx, {
      action: 'comms.escalation.withdraw',
      status: 'ok',
      resourceType: 'comms_escalation',
      resourceId: id,
      detail: { level: closed.currentLevel },
    });
    return { escalation: toEscalationDto(closed) };
  });
}
