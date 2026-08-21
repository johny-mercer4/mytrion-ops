/**
 * After the desk attaches a Phase-1 file.
 *
 * `documentService.upload` writes bytes only. Sales then calls `applicationService.get`, which
 * refreshes the missing list but does NOT open the gate — Sales still has to Submit. The desk has
 * no Submit: Pass is locked until `verification_process` is true. Without `submitting: true` here,
 * attaching the last required statement left the case red, Save disabled (nothing dirty), and
 * Pass locked — a deadlock the reviewer could not break from the desk.
 */
import {
  APPLICATION_DOCUMENTS_UPLOADED,
  APPLICATION_UPDATED,
  publishVerificationApplicationEvent,
} from '../verification/caseNotify.js';
import { applicationService, zohoFromCtx } from './applicationService.js';
import { deskService } from './deskService.js';
import type { TenantContext } from '../../types/tenantContext.js';

async function afterDeskDocumentWrite(
  ctx: TenantContext,
  caseId: string,
  event: { type: string; title: string },
): Promise<Awaited<ReturnType<typeof deskService.detail>>> {
  await applicationService.refreshGate(ctx, caseId, {
    submitting: true,
    actor: zohoFromCtx(ctx),
    actorName: ctx.userName || ctx.userId,
  });
  const detail = await deskService.detail(ctx, caseId);
  const owner = (detail.case as { verificationOwnerZohoUserId?: string | null })
    .verificationOwnerZohoUserId;
  publishVerificationApplicationEvent({
    caseId,
    type: event.type,
    verificationOwnerZohoUserId: owner,
    title: event.title,
  });
  return detail;
}

export async function afterDeskDocumentUpload(
  ctx: TenantContext,
  caseId: string,
): Promise<Awaited<ReturnType<typeof deskService.detail>>> {
  return afterDeskDocumentWrite(ctx, caseId, {
    type: APPLICATION_DOCUMENTS_UPLOADED,
    title: 'Application documents updated',
  });
}

/** Same gate refresh as upload — removing a required file can lock the case again. */
export async function afterDeskDocumentRemove(
  ctx: TenantContext,
  caseId: string,
): Promise<Awaited<ReturnType<typeof deskService.detail>>> {
  return afterDeskDocumentWrite(ctx, caseId, {
    type: APPLICATION_UPDATED,
    title: 'Application document removed',
  });
}
