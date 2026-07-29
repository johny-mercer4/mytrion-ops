import { createId } from '@paralleldrive/cuid2';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { browserAutomationRequest } from '../../integrations/browserAutomation.js';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { createInboxMessage } from '../inbox/service.js';
import { payloadToContext, salesBocaRequestJob } from '../jobs/catalog.js';
import { assertWexApplicationActionAllowed } from '../sales/wexApplicationGuard.js';

type BocaPayload = z.infer<typeof salesBocaRequestJob.schema>;

function resultMessage(appId: string, result: Record<string, unknown>): string {
  if (result.action === 'skipped') {
    return `BOCA was skipped for Application ${appId}: ${String(result.reason || result.status || 'application status does not require it')}.`;
  }
  const status = result.status ? ` WEX status: ${String(result.status)}.` : '';
  return `BOCA task completed for Application ${appId}.${status}`;
}

async function notifyRequester(
  payload: BocaPayload,
  input: { ok: boolean; content: string },
): Promise<void> {
  const ctx = payloadToContext(payload.ctx);
  await createInboxMessage(ctx, {
    ownerZohoUserId: ctx.userId,
    ownerName: ctx.userName ?? null,
    ownerEmail: ctx.email ?? null,
    subject: input.ok ? 'BOCA request completed' : 'BOCA request failed',
    content: input.content,
    type: 'Automation',
    priority: input.ok ? 'medium' : 'high',
    tag: 'C-27',
    name: `Application ${payload.appId}`,
    zohoRecordId: payload.requestKey,
  });
}

/** Long-running browser operation. Always attempts to write a completion/failure inbox message. */
export async function runBocaRequest(payload: BocaPayload): Promise<Record<string, unknown>> {
  const ctx = payloadToContext(payload.ctx);
  const path = `/wex/boca/${encodeURIComponent(payload.appId)}`;
  let outcome: Record<string, unknown>;
  let ok = false;
  try {
    // Re-check at execution time: an application can become Closed/Lost,
    // Expansion, or Cards Sent after the request was initially queued.
    await assertWexApplicationActionAllowed(payload.appId, 'BOCA Link Request');
    const result = await browserAutomationRequest<unknown>('POST', path, {
      body: {
        assignedTo: payload.assignedTo,
        priority: payload.priority,
        dueDate: payload.dueDate,
        status: payload.status,
      },
    });
    outcome = typeof result === 'object' && result !== null
      ? { ...result as Record<string, unknown> }
      : { result };
    if (outcome.success === false) {
      throw new Error(String(outcome.message || outcome.error || 'Browser automation rejected the request.'));
    }
    ok = true;
  } catch (err) {
    outcome = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const content = ok
    ? resultMessage(payload.appId, outcome)
    : `BOCA failed for Application ${payload.appId}: ${String(outcome.error || 'Unknown error')}. You can retry from Sales Mytrion.`;
  try {
    await notifyRequester(payload, { ok, content });
  } catch (err) {
    logger.error({ err, appId: payload.appId, ownerId: payload.ctx.userId }, 'BOCA inbox notification failed');
  }
  await auditFromContext(ctx, {
    action: 'sales.boca_request.completed',
    status: ok ? 'ok' : 'error',
    resourceType: 'wex_application',
    resourceId: payload.appId,
    detail: { requestKey: payload.requestKey, outcome },
  });
  return outcome;
}

export async function submitBocaRequest(
  ctx: TenantContext,
  input: Omit<BocaPayload, 'ctx' | 'requestKey'>,
): Promise<{ accepted: true; action: 'queued'; jobId: string | null }> {
  // Reject synchronously so the agent sees the business guard before a job is
  // accepted. The worker repeats this check immediately before automation.
  await assertWexApplicationActionAllowed(input.appId, 'BOCA Link Request');
  const payload: BocaPayload = {
    ctx,
    requestKey: `boca-${ctx.requestId}-${input.appId}-${createId()}`,
    ...input,
  };
  if (env.FF_JOBS_ENABLED && env.JOBS_WORKER_MODE !== 'off') {
    // Lazy import avoids a startup cycle: queue -> boss -> worker registry -> BOCA worker.
    const { enqueue } = await import('../jobs/queue.js');
    const jobId = await enqueue(salesBocaRequestJob, payload);
    return { accepted: true, action: 'queued', jobId };
  }
  // Local/dev fallback when pg-boss is intentionally off. The HTTP response is still immediate.
  void runBocaRequest(payload).catch((err) => {
    logger.error({ err, appId: payload.appId }, 'in-process BOCA request failed');
  });
  return { accepted: true, action: 'queued', jobId: null };
}
