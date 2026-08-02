import {
  ESCALATION_LEVEL_LABELS,
  type EscalationLevel,
  type MytrionEscalation,
} from '../../db/schema/index.js';
import { ConflictError, NotFoundError, RBACError } from '../../lib/errors.js';
import { commsEscalationRepo } from '../../repos/commsEscalationRepo.js';
import { commsMessageRepo } from '../../repos/commsMessageRepo.js';
import { commsSettingsRepo, slaHoursFor } from '../../repos/commsSettingsRepo.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { actorZohoUserIdOf } from '../../repos/commsThreadRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { publishSafely, publishThreadEvent, publishUserEvent } from './publish.js';

/**
 * Shared pieces of the escalation state machine: hop deadlines, the fan-out, and the act-on gate.
 *
 * Split out of escalationService/escalationTransitions because both halves need all three, and the two
 * together were over the 600-line cap. Keeping the fan-out in ONE place matters for the same reason
 * publish.ts exists: "did the new assignee get told?" should have one answer to audit, not one per
 * transition.
 */

export type EscalationEventType =
  | 'comms.escalation.raised'
  | 'comms.escalation.advanced'
  | 'comms.escalation.handed_off'
  | 'comms.escalation.resolved';

/**
 * Chain length ceiling.
 *
 * Every hop is human-initiated, so a runaway loop needs people clicking — but two departments whose
 * configs point at each other make a bounce cheap, and an unbounded chain turns the hop list into an
 * unreadable wall. 12 is far past any real ladder (raise → agent → manager → C-Level is 4).
 */
export const MAX_HOPS = 12;

/**
 * Deadline for one hop, from the tenant settings map.
 *
 * Escalations read the 'high' band rather than carrying their own column: an escalation IS the urgent
 * path, and giving it a second SLA knob would mean two places to change the same answer.
 */
export async function hopDueAt(
  ctx: TenantContext,
  from: Date,
): Promise<{ hours: number; dueAt: Date }> {
  const settings = await commsSettingsRepo.getEffective(ctx);
  const hours = slaHoursFor(settings.slaHoursByPriority, 'high', 4);
  return { hours, dueAt: new Date(from.getTime() + hours * 3_600_000) };
}

export interface NotifyChainArgs {
  threadId: string;
  escalationId: string;
  ticketId: string;
  type: EscalationEventType;
  level: EscalationLevel;
  assignee: string | null;
  assigneeName: string | null;
  number?: string;
  actor: string;
  systemBody?: string;
}

/** Write the movement into the conversation and fan the frame out to everyone on the chain. */
export async function notifyChain(ctx: TenantContext, args: NotifyChainArgs): Promise<void> {
  // A system message, not an internal note: the movement belongs in the conversation everyone on the
  // chain reads, and `kind='system'` is what lets the client render it as a divider rather than a bubble.
  if (args.systemBody) {
    await commsMessageRepo.append(ctx, {
      threadId: args.threadId,
      body: args.systemBody,
      kind: 'system',
      authorKind: 'system',
      authorName: 'Escalation',
      systemEvent: args.type.replace('comms.escalation.', ''),
      detail: { level: args.level, assignee: args.assignee },
    });
  }

  const members = await commsThreadMemberRepo.listByThread(ctx, args.threadId);
  publishSafely(args.type, () => {
    publishThreadEvent(
      // department null on purpose: an escalation thread is never department-visible, so there is no
      // queue topic to fan out to and `alsoQueue` must never fire for one.
      { id: args.threadId, department: null },
      members,
      {
        type: args.type,
        threadId: args.threadId,
        escalationId: args.escalationId,
        ticketId: args.ticketId,
        level: args.level,
        levelLabel: ESCALATION_LEVEL_LABELS[args.level],
        assigneeZohoUserId: args.assignee,
        assigneeName: args.assigneeName,
        ...(args.number ? { number: args.number } : {}),
      },
      { excludeMemberKey: args.actor },
    );
    // Direct ping to the new assignee. The fan-out above already covers them once they hold a member row,
    // but this fires on the same tick as the transfer, so ordering must not decide whether the person now
    // responsible hears about it.
    if (args.assignee && args.assignee !== args.actor) {
      publishUserEvent(args.assignee, {
        type: args.type,
        threadId: args.threadId,
        escalationId: args.escalationId,
        ticketId: args.ticketId,
        level: args.level,
      });
    }
  });
}

/**
 * Load an escalation the caller may MOVE, or throw.
 *
 * Three refusals, each a different HTTP answer: 404 for unreadable (so a guessed id is not confirmed),
 * 409 for already-terminal or a stale version, 403 for "not yours to move". Blanket access is let through
 * because an admin unblocking a stuck chain is a real operation — and every route that calls this audits.
 */
export async function loadForDecision(
  ctx: TenantContext,
  escalationId: string,
  expectedVersion: number,
): Promise<{ escalation: MytrionEscalation; actor: string }> {
  const actor = actorZohoUserIdOf(ctx);
  if (!actor) throw new RBACError('Deciding an escalation requires a signed-in worker identity.');

  const escalation = await commsEscalationRepo.getForReader(ctx, escalationId);
  if (!escalation) throw new NotFoundError('Escalation not found.');
  if (escalation.status !== 'pending') {
    throw new ConflictError(`This escalation is already ${escalation.status}.`);
  }
  if (escalation.version !== expectedVersion) {
    throw new ConflictError(
      'This escalation moved while you were looking at it. Reload and try again.',
    );
  }

  const blanket = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
  if (!blanket && escalation.currentAssigneeZohoUserId !== actor) {
    throw new RBACError('Only the person this escalation is currently with can move it.');
  }
  return { escalation, actor };
}
