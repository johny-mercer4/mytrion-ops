/**
 * Retention workflow notifications — persist inbox_events then push over the
 * Octane realtime hub so Sales agents see cases / pool / Ops prompts live.
 */
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  publishInboxEvent,
  realtimeHub,
  RETENTION_POOL_TOPIC,
} from '../realtime/hub.js';
import { inboxEventRepo, type InboxEventDto } from '../../repos/inboxEventRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

async function persistAndPublish(
  ctx: TenantContext,
  input: {
    ownerId: string;
    type: string;
    title: string;
    detail: string;
    priority?: 'low' | 'medium' | 'high';
    /** Also fan out on retention:pool (all Sales sockets). */
    broadcastPool?: boolean;
  },
): Promise<InboxEventDto> {
  const event = await inboxEventRepo.create(ctx, {
    ownerKind: 'worker',
    ownerId: input.ownerId,
    type: input.type,
    tag: 'retention',
    priority: input.priority ?? 'high',
    title: input.title,
    detail: input.detail,
  });
  publishInboxEvent(event);
  if (input.broadcastPool) {
    realtimeHub.publish(RETENTION_POOL_TOPIC, event);
  }
  return event;
}

/** New Phase-1 case assigned to a sales agent — realtime push to that agent. */
export async function notifyCaseCreated(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
    assignedAgentZohoUserId: string | null | undefined;
    daysInactive?: number | null;
    thresholdDays?: number | null;
  },
): Promise<void> {
  const ownerId = opts.assignedAgentZohoUserId?.trim();
  if (!ownerId) {
    logger.info(
      { caseId: opts.caseId, carrierId: opts.carrierId },
      'retention.case.created notify skipped: no assigned agent',
    );
    return;
  }
  const company = opts.companyName?.trim() || opts.carrierId;
  const quiet =
    opts.daysInactive != null && opts.thresholdDays != null
      ? ` · ${opts.daysInactive}d quiet (threshold ${opts.thresholdDays}d)`
      : '';
  await persistAndPublish(ctx, {
    ownerId,
    type: 'retention.case.created',
    title: `New retention case: ${company}`,
    detail: `caseId=${opts.caseId} · carrier=${opts.carrierId}${quiet} · 2 BD to act`,
  });
}

export async function notifyOpenPoolOpened(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
    /** Previous deal-owner Zoho id (also notified when set). */
    previousOwnerZohoUserId?: string | null;
  },
): Promise<void> {
  const ryanId = env.RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID.trim();
  const title = `Open Pool: ${opts.companyName?.trim() || opts.carrierId}`;
  const detail = `caseId=${opts.caseId} · carrier=${opts.carrierId} · claim within 3 BD`;
  const targets = new Set<string>();
  if (ryanId) targets.add(ryanId);
  const prev = opts.previousOwnerZohoUserId?.trim();
  if (prev) targets.add(prev);
  if (targets.size === 0) {
    logger.info(
      { caseId: opts.caseId },
      'retention open-pool inbox notify skipped (no Ryan/owner id) — still broadcasting pool topic',
    );
    realtimeHub.publish(RETENTION_POOL_TOPIC, {
      id: `pool-${opts.caseId}`,
      type: 'retention.pool.opened',
      tag: 'retention',
      ownerKind: 'worker',
      ownerId: 'system',
      title,
      detail,
      priority: 'high',
      readAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  let i = 0;
  for (const ownerId of targets) {
    await persistAndPublish(ctx, {
      ownerId,
      type: 'retention.pool.opened',
      title,
      detail,
      // One pool broadcast is enough — attach to the first inbox write.
      broadcastPool: i === 0,
    });
    i += 1;
  }
}

export async function notifyClaimRequestToOwner(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
    ownerZohoUserId: string;
    claimantZohoUserId: string;
  },
): Promise<void> {
  await persistAndPublish(ctx, {
    ownerId: opts.ownerZohoUserId,
    type: 'retention.claim_request',
    title: `Claim request: ${opts.companyName?.trim() || opts.carrierId}`,
    detail: `caseId=${opts.caseId} · carrier=${opts.carrierId} · claimant=${opts.claimantZohoUserId} · Approve in Retention → Claims (1 BD auto)`,
  });
}

export async function notifyClaimApproved(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
    claimantZohoUserId: string;
  },
): Promise<void> {
  await persistAndPublish(ctx, {
    ownerId: opts.claimantZohoUserId,
    type: 'retention.claim_approved',
    title: `Claim approved: ${opts.companyName?.trim() || opts.carrierId}`,
    detail: `caseId=${opts.caseId} · You now own this deal — 3 BD to get a transaction`,
  });
}

export async function notifyClaimDeclined(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
    claimantZohoUserId: string;
  },
): Promise<void> {
  await persistAndPublish(ctx, {
    ownerId: opts.claimantZohoUserId,
    type: 'retention.claim_declined',
    title: `Claim declined: ${opts.companyName?.trim() || opts.carrierId}`,
    detail: `caseId=${opts.caseId} · Owner declined — deal stays in Open Pool`,
  });
}

export async function notifyOpsVacationSignoff(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
  },
): Promise<void> {
  const opsId =
    env.RETENTION_OPS_MANAGER_ZOHO_USER_ID.trim() ||
    env.RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID.trim();
  if (!opsId) {
    logger.info(
      { caseId: opts.caseId },
      'retention ops notify skipped: RETENTION_OPS_MANAGER_ZOHO_USER_ID unset',
    );
    return;
  }
  await persistAndPublish(ctx, {
    ownerId: opsId,
    type: 'retention.ops.vacation_signoff',
    title: `Vacation confirm: ${opts.companyName?.trim() || opts.carrierId}`,
    detail: `caseId=${opts.caseId} · Confirm → Phase 1 · Deny → CITI`,
  });
}
