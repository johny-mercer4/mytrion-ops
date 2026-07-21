/**
 * Retention workflow notifications — persist inbox_events then push over the
 * Octane realtime hub so Sales agents see cases / pool / Ops prompts live.
 *
 * Open Pool entry: inbox + WS for Ryan (`RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID`)
 * + previous deal owner. Outbound email is owned by Zapier (not Zoho send_mail here).
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

/** Why a case landed in Sales Open Pool — drives inbox / WS copy. */
export type OpenPoolEntryReason = 'out_of_reach' | 'reached' | 'reclaim' | 'phase2';

export function openPoolEntryReasonLabel(reason: OpenPoolEntryReason): string {
  switch (reason) {
    case 'out_of_reach':
      return 'after 5 Out of Reach attempts';
    case 'reached':
      return 'after 5 BD with no new transaction (Reached)';
    case 'reclaim':
      return "after the new owner's 3 BD window with no transaction";
    case 'phase2':
      return 'from Retention Phase 2 (10 BD watch or no response)';
  }
}

export function formatOpenPoolNotifyDetail(opts: {
  caseId: string;
  carrierId: string;
  reason: OpenPoolEntryReason;
}): string {
  return `caseId=${opts.caseId} · carrier=${opts.carrierId} · ${openPoolEntryReasonLabel(opts.reason)} · claim within 3 BD`;
}

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
    /** Why the case entered Open Pool (inbox / WS detail). */
    reason: OpenPoolEntryReason;
    /** Previous deal-owner Zoho id (also notified when set). */
    previousOwnerZohoUserId?: string | null;
    /** CRM deal id — kept for callers / future Zapier hooks; not emailed from here. */
    zohoDealId?: string | null;
  },
): Promise<void> {
  const ryanId = env.RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID.trim();
  const title = `Open Pool: ${opts.companyName?.trim() || opts.carrierId}`;
  const detail = formatOpenPoolNotifyDetail({
    caseId: opts.caseId,
    carrierId: opts.carrierId,
    reason: opts.reason,
  });
  const targets = new Set<string>();
  if (ryanId) targets.add(ryanId);
  const prev = opts.previousOwnerZohoUserId?.trim();
  if (prev) targets.add(prev);
  if (targets.size === 0) {
    logger.info(
      { caseId: opts.caseId, reason: opts.reason },
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
  } else {
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
    detail: `caseId=${opts.caseId} · carrier=${opts.carrierId} · claimant=${opts.claimantZohoUserId} · Approve in CS → Open Pool Claims (1 BD auto)`,
  });
}

/** Notify CS distribution + broadcast retention:pool when Sales requests a claim. */
export async function notifyClaimRequestToCs(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
    claimantZohoUserId: string;
    previousOwnerZohoUserId?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  const company = opts.companyName?.trim() || opts.carrierId;
  const reasonBit = opts.reason?.trim()
    ? ` · reason=${opts.reason.trim().slice(0, 120)}`
    : '';
  const detail = `caseId=${opts.caseId} · carrier=${opts.carrierId} · claimant=${opts.claimantZohoUserId}${reasonBit} · Approve in CS → Open Pool Claims (1 BD auto)`;
  const csId =
    env.RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID.trim() ||
    env.RETENTION_OPS_MANAGER_ZOHO_USER_ID.trim();
  if (csId) {
    await persistAndPublish(ctx, {
      ownerId: csId,
      type: 'retention.claim_request',
      title: `Open Pool claim: ${company}`,
      detail,
      broadcastPool: true,
    });
  } else {
    const now = new Date().toISOString();
    realtimeHub.publish(RETENTION_POOL_TOPIC, {
      id: `claim-req-${opts.caseId}`,
      ownerKind: 'worker',
      ownerId: 'customer-service',
      type: 'retention.claim_request',
      tag: 'retention',
      priority: 'high',
      title: `Open Pool claim: ${company}`,
      detail,
      createdAt: now,
      updatedAt: now,
      readAt: null,
    });
    logger.info(
      { caseId: opts.caseId },
      'retention claim CS notify: no RETENTION_* notify user — pool broadcast only',
    );
  }
  const prev = opts.previousOwnerZohoUserId?.trim();
  if (prev && prev !== csId) {
    await notifyClaimRequestToOwner(ctx, {
      caseId: opts.caseId,
      carrierId: opts.carrierId,
      companyName: opts.companyName,
      ownerZohoUserId: prev,
      claimantZohoUserId: opts.claimantZohoUserId,
    });
  }
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
    detail: `caseId=${opts.caseId} · You now own this deal — 2 BD to act (Kanban New)`,
    broadcastPool: true,
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
    detail: `caseId=${opts.caseId} · Claim declined — deal stays in Open Pool`,
    broadcastPool: true,
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
