/**
 * Retention workflow notifications — persist inbox_events then push over the
 * Octane realtime hub so Sales agents see cases / pool / Ops prompts live.
 *
 * Open Pool (5 OoR attempts): inbox + WS for Ryan / deal owner, plus best-effort
 * Zoho CRM Send Mail (`/{Deals}/{id}/actions/send_mail`) when a deal id + emails resolve.
 */
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
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

async function resolveCrmEmail(
  zohoUserId: string,
): Promise<{ email: string; name: string | null } | null> {
  try {
    const user = await zohoCrm.getUserById(zohoUserId);
    const email = user?.email?.trim();
    if (!email) return null;
    return { email, name: user?.name ?? null };
  } catch (err) {
    logger.warn(
      { err, zohoUserId },
      'retention open-pool: Zoho user email lookup failed',
    );
    return null;
  }
}

async function resolveFromAddress(): Promise<{ email: string; userName: string | null } | null> {
  const configured = env.RETENTION_NOTIFY_FROM_EMAIL.trim();
  try {
    const addrs = await zohoCrm.listFromAddresses();
    if (configured) {
      const match = addrs.find((a) => a.email.toLowerCase() === configured.toLowerCase());
      if (match) return match;
      return { email: configured, userName: null };
    }
    return addrs[0] ?? null;
  } catch (err) {
    logger.warn({ err }, 'retention open-pool: from_addresses lookup failed');
    return configured ? { email: configured, userName: null } : null;
  }
}

/**
 * Best-effort Zoho CRM Send Mail to Ryan + current deal owner when a deal enters Open Pool.
 * Never throws — inbox notify remains the primary path if mail scopes/deal id are missing.
 */
async function emailOpenPoolOpened(opts: {
  caseId: string;
  carrierId: string;
  companyName: string | null;
  zohoDealId?: string | null;
  ryanZohoUserId?: string | null;
  previousOwnerZohoUserId?: string | null;
}): Promise<void> {
  const dealId = opts.zohoDealId?.trim();
  if (!dealId || !zohoCrm.isConfigured()) {
    logger.info(
      { caseId: opts.caseId, hasDeal: Boolean(dealId) },
      'retention open-pool Zoho email skipped (no deal id or CRM not configured)',
    );
    return;
  }

  const from = await resolveFromAddress();
  if (!from) {
    logger.info({ caseId: opts.caseId }, 'retention open-pool Zoho email skipped (no from address)');
    return;
  }

  const recipients: Array<{ email: string; userName: string | null }> = [];
  const seen = new Set<string>();
  for (const id of [opts.ryanZohoUserId, opts.previousOwnerZohoUserId]) {
    const trimmed = id?.trim();
    if (!trimmed) continue;
    const resolved = await resolveCrmEmail(trimmed);
    if (!resolved || seen.has(resolved.email.toLowerCase())) continue;
    seen.add(resolved.email.toLowerCase());
    recipients.push({ email: resolved.email, userName: resolved.name });
  }
  if (recipients.length === 0) {
    logger.info({ caseId: opts.caseId }, 'retention open-pool Zoho email skipped (no recipient emails)');
    return;
  }

  const company = opts.companyName?.trim() || opts.carrierId;
  const subject = `Sales Open Pool: ${company} (${opts.carrierId})`;
  const content = [
    `${company} entered the Sales Open Pool after 5 Out of Reach attempts.`,
    ``,
    `Carrier ID: ${opts.carrierId}`,
    `Case ID: ${opts.caseId}`,
    `Deal ID: ${dealId}`,
    ``,
    `Agents may claim from Retention → Open Pool (3 BD per claim, max 3 agents).`,
    `Ryan Saab is notified for visibility; the previous deal owner is copied.`,
  ].join('\n');

  try {
    await zohoCrm.sendMailOnRecord('Deals', dealId, {
      from,
      to: recipients,
      subject,
      content,
    });
    logger.info(
      {
        caseId: opts.caseId,
        dealId,
        recipients: recipients.map((r) => r.email),
      },
      'retention open-pool Zoho email sent',
    );
  } catch (err) {
    logger.warn(
      { err, caseId: opts.caseId, dealId },
      'retention open-pool Zoho email failed (inbox notify still delivered)',
    );
  }
}

export async function notifyOpenPoolOpened(
  ctx: TenantContext,
  opts: {
    caseId: string;
    carrierId: string;
    companyName: string | null;
    /** Previous deal-owner Zoho id (also notified when set). */
    previousOwnerZohoUserId?: string | null;
    /** CRM deal id — enables Zoho Send Mail on the deal. */
    zohoDealId?: string | null;
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

  await emailOpenPoolOpened({
    caseId: opts.caseId,
    carrierId: opts.carrierId,
    companyName: opts.companyName,
    ...(opts.zohoDealId != null ? { zohoDealId: opts.zohoDealId } : {}),
    ...(ryanId ? { ryanZohoUserId: ryanId } : {}),
    ...(prev ? { previousOwnerZohoUserId: prev } : {}),
  });
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
  },
): Promise<void> {
  const company = opts.companyName?.trim() || opts.carrierId;
  const detail = `caseId=${opts.caseId} · carrier=${opts.carrierId} · claimant=${opts.claimantZohoUserId} · Approve in CS → Open Pool Claims (1 BD auto)`;
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
    detail: `caseId=${opts.caseId} · Claim declined — deal stays in Open Pool`,
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
