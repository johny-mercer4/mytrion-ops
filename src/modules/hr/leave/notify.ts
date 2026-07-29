import { logger } from '../../../lib/logger.js';
import { publishInboxEvent } from '../../realtime/hub.js';
import { inboxEventRepo } from '../../../repos/inboxEventRepo.js';
import type { HrEmployeeRow } from '../../../repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';

function employeeName(employee: Pick<HrEmployeeRow, 'firstName' | 'lastName'>): string {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

async function notify(
  ctx: TenantContext,
  recipient: HrEmployeeRow,
  input: { type: string; title: string; detail: string; priority?: 'medium' | 'high' },
): Promise<void> {
  const ownerId = recipient.zohoUserId?.trim();
  if (!ownerId) {
    logger.warn(
      { recipientEmployeeId: recipient.id, eventType: input.type },
      'time-off notification skipped: employee has no Zoho login mapping',
    );
    return;
  }
  try {
    const event = await inboxEventRepo.create(ctx, {
      ownerKind: 'worker',
      ownerId,
      type: input.type,
      tag: 'time-off',
      priority: input.priority ?? 'high',
      title: input.title,
      detail: input.detail,
    });
    publishInboxEvent(event);
  } catch (err) {
    // Approval state is already committed at this point. A transient notification failure must not
    // make the client retry the write and mistake a successful transition for a failed one.
    logger.error(
      { err, recipientEmployeeId: recipient.id, eventType: input.type },
      'time-off notification failed after workflow transition',
    );
  }
}

export async function notifyLeaveAwaitingApproval(
  ctx: TenantContext,
  input: {
    recipient: HrEmployeeRow;
    requester: HrEmployeeRow;
    requestId: string;
    leaveTypeName: string;
    fromDate: string;
    toDate: string;
    requestedDays: number;
    stage: 'department lead' | 'HR final approval';
  },
): Promise<void> {
  await notify(ctx, input.recipient, {
    type: 'hr.time_off.approval_required',
    title: `Time off needs ${input.stage}`,
    detail:
      `${employeeName(input.requester)} · ${input.leaveTypeName} · ` +
      `${input.fromDate}–${input.toDate} · ${input.requestedDays} day(s) · ` +
      `request=${input.requestId}`,
  });
}

export async function notifyLeaveResolved(
  ctx: TenantContext,
  input: {
    recipient: HrEmployeeRow;
    requestId: string;
    leaveTypeName: string;
    fromDate: string;
    toDate: string;
    decision: 'approved' | 'rejected' | 'cancelled';
  },
): Promise<void> {
  await notify(ctx, input.recipient, {
    type: `hr.time_off.${input.decision}`,
    title: `Time off ${input.decision}`,
    detail:
      `${input.leaveTypeName} · ${input.fromDate}–${input.toDate} · ` +
      `request=${input.requestId}`,
    priority: input.decision === 'approved' ? 'medium' : 'high',
  });
}
