/**
 * The PENDING DOCUMENTS round trip — asking Sales for a file, and coming back afterwards.
 *
 * Split out of `deskService` for the 600-line cap, and the pair belongs together because they are two
 * halves of one SOP rule: the ask parks the case on the phase that RAISED it (`requested_in_phase`),
 * and the resume returns it to that same phase rather than to the start of the flow. Separating them
 * is how a case comes back to the wrong place.
 */
import { AppError } from '../../lib/errors.js';
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import {
  VERIFICATION_PHASE,
  VERIFICATION_STATUS,
  type VerificationDocType,
} from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

import { documentService } from './documentService.js';
import { deskService, loadWorkable } from './deskService.js';
import { withFlowSchemaGuard, zohoFromCtx } from './applicationService.js';
import { isPhaseCode, phaseByCode } from './phases.js';
import { resolveDocumentReturnPhase, resolvePhaseDecision } from './stateMachine.js';

export async function requestDocuments(
  ctx: TenantContext,
  caseId: string,
  input: { phaseCode: string; items: Array<{ docType: VerificationDocType; label?: string | undefined }>; note?: string | undefined },
) {
  return withFlowSchemaGuard(async () => {
    const row = await loadWorkable(ctx, caseId);
    for (const item of input.items) {
      await documentService.request(ctx, caseId, {
        docType: item.docType,
        label: item.label,
        phaseCode: input.phaseCode,
      });
    }
    // Recording the ask as a phase decision is what parks the case on `pending_docs` and stamps
    // `requested_in_phase` — the two halves of the return-to-the-phase-that-asked rule.
    const patch = resolvePhaseDecision({
      phase: isPhaseCode(input.phaseCode) ? input.phaseCode : VERIFICATION_PHASE.intake,
      outcome: 'pending_docs',
      applicantType: row.applicantType,
      note: input.note ?? `Requested ${input.items.length} document(s) from Sales.`,
    });
    await verificationFlowRepo.applyTransition(ctx, caseId, {
      ...patch,
      decidedPhase: input.phaseCode,
      outcome: 'pending_docs',
      eventType: 'docs_requested',
      actorZohoUserId: zohoFromCtx(ctx),
      actorName: ctx.userName || ctx.userId,
      ...(patch.eventNotes === undefined ? {} : { eventNotes: patch.eventNotes }),
    });
    return deskService.detail(ctx, caseId);
  });
}

/**
 * Resume once the outstanding asks are fulfilled. Returns the case to the phase that RAISED the
 * request, per the SOP, rather than to the start of the flow.
 */
export async function resumeAfterDocuments(ctx: TenantContext, caseId: string) {
  return withFlowSchemaGuard(async () => {
    const row = await loadWorkable(ctx, caseId);
    const outstanding = await verificationCaseAssetRepo.listOutstandingRequests(ctx, caseId);
    if (outstanding.length > 0) {
      throw new AppError(
        `${outstanding.length} requested document(s) are still outstanding.`,
        { statusCode: 409, code: 'VERIFICATION_DOCS_OUTSTANDING', expose: true },
      );
    }
    const documents = await verificationCaseAssetRepo.listDocuments(ctx, caseId);
    const lastRequestPhase =
      documents.find((d) => d.requestedInPhase)?.requestedInPhase ?? row.phaseCode;
    const target = resolveDocumentReturnPhase(lastRequestPhase, row.applicantType);

    await verificationFlowRepo.applyTransition(ctx, caseId, {
      phaseCode: target,
      statusCode: VERIFICATION_STATUS.inReview,
      phaseStatus: 'in_progress',
      decidedPhase: target,
      closed: false,
      eventType: 'docs_received',
      eventNotes: `Documents received — resumed at ${phaseByCode(target)?.label ?? target}.`,
      actorZohoUserId: zohoFromCtx(ctx),
      actorName: ctx.userName || ctx.userId,
    });
    return deskService.detail(ctx, caseId);
  });
}
