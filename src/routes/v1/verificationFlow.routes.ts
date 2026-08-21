/**
 * Verification-desk underwriting routes — the other door onto the shared case row.
 *
 * VERIFICATION-gated, where `verificationApplications.routes.ts` is SALES-gated. Same rows, two
 * departments, different verbs: Sales fills intake, the desk underwrites.
 *
 * Mounted under `/verification/flow/*` rather than `/verification/cases/*` so the retired
 * credit-platform Decision Desk routes keep working untouched while they are quarantined.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { deskService } from '../../modules/verificationFlow/deskService.js';
import { documentService } from '../../modules/verificationFlow/documentService.js';
import {
  VERIFICATION_APPLICANT_TYPES,
  VERIFICATION_DOC_TYPES,
  VERIFICATION_PHASE_OUTCOMES,
  VERIFICATION_RISK_TIERS,
  VERIFICATION_ROUTES,
  VERIFICATION_SCREENING_VERDICTS,
  VERIFICATION_TRENDS,
  VERIFICATION_VOLATILITY,
  VERIFICATION_CREDIT_OUTCOMES,
} from '../../db/schema/verification_flow.js';
import type { IntakePatch } from '../../modules/verificationFlow/applicationService.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  patchBody as intakePatchBody,
  principalBody as deskPrincipalBody,
} from './verificationApplications.routes.js';
import { applicationService } from '../../modules/verificationFlow/applicationService.js';
import {
  afterDeskDocumentRemove,
  afterDeskDocumentUpload,
} from '../../modules/verificationFlow/deskPhase1Writes.js';
import { readDeskBrokerSnapshot } from '../../modules/verificationFlow/deskSnapshot.js';
import { AppError } from '../../lib/errors.js';
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
} from '../../modules/verificationFlow/documentService.js';

const deskPrincipalParams = z.object({
  id: z.string().min(1),
  principalId: z.string().min(1),
});
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification underwriting');
}
function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification underwriting');
}

const idParams = z.object({ id: z.string().min(1) });
const docParams = z.object({ id: z.string().min(1), documentId: z.string().min(1) });
const phaseParams = z.object({ id: z.string().min(1), phase: z.string().min(1) });
const hitParams = z.object({ id: z.string().min(1), hitId: z.string().min(1) });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  statusCode: z.string().trim().min(1).optional(),
  phaseCode: z.string().trim().min(1).optional(),
  applicantType: z.enum(VERIFICATION_APPLICANT_TYPES).optional(),
  underwritingRoute: z.enum(VERIFICATION_ROUTES).optional(),
  gate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const decisionBody = z.object({
  outcome: z.enum(VERIFICATION_PHASE_OUTCOMES),
  note: z.string().trim().max(2000).optional(),
  findings: z
    .object({ reviewOrder: z.enum(['banking_first', 'credit_first']) })
    .optional(),
});

/**
 * A reason, REQUIRED. Reopening withdraws a decision somebody else recorded, so `min(3)` rather than
 * `min(1)`: a single character satisfies "required" and tells the next reviewer nothing.
 */
const reopenBody = z.object({
  reason: z.string().trim().min(3).max(2000),
});

const verdictBody = z.object({
  verdict: z.enum(VERIFICATION_SCREENING_VERDICTS),
  note: z.string().trim().max(2000).optional(),
});

/** Money arrives as a number and is stored as numeric text; nulls clear a field. */
const money = z.coerce.number().min(-99_999_999).max(99_999_999).nullable().optional();
const count = z.coerce.number().int().min(0).max(100_000).nullable().optional();

const creditBody = z.object({
  creditScore: z.coerce.number().int().min(0).max(900).nullable().optional(),
  latePayments: count,
  collections: count,
  utilizationPct: z.coerce.number().min(0).max(999).nullable().optional(),
  inquiries12m: count,
  historyMonths: count,
  openAccounts: count,
  totalDebt: money,
  revolvingAccounts: count,
  autoLoans: count,
  mortgages: count,
  repaymentBehavior: z.string().trim().max(500).nullable().optional(),
  recentTrend: z.enum(VERIFICATION_TRENDS).nullable().optional(),
  bureauNoHit: z.boolean().optional(),
  outcome: z.enum(VERIFICATION_CREDIT_OUTCOMES).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const bankingBody = z.object({
  periodStart: z.string().trim().max(20).nullable().optional(),
  periodEnd: z.string().trim().max(20).nullable().optional(),
  accountOwnershipVerified: z.boolean().optional(),
  monthlyRevenue: money,
  weeklyRevenue: money,
  revenueTrend: z.enum(VERIFICATION_TRENDS).nullable().optional(),
  recurringWeeklyIncome: money,
  recurringWeeklyExpenses: money,
  avgMonthlyNetCashFlow: money,
  avgDailyBalance: money,
  endingBalance: money,
  minimumBalance: money,
  negativeBalanceDays: count,
  nsfCount: count,
  achReturnCount: count,
  overdraftCount: count,
  avgWeeklyFuelExpense: money,
  existingDebtPayments: money,
  oneTimeDeposits: money,
  unusualTransactions: z.string().trim().max(2000).nullable().optional(),
  cashFlowVolatility: z.enum(VERIFICATION_VOLATILITY).nullable().optional(),
  bankingInconsistentWithOperations: z.boolean().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const riskBody = z.object({
  riskTier: z.enum(VERIFICATION_RISK_TIERS),
  businessAgeMonths: z.coerce.number().int().min(0).max(2400).optional(),
  authorityAgeMonths: z.coerce.number().int().min(0).max(2400).optional(),
  analystRecommendation: z.string().trim().max(4000).optional(),
  keyRisks: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
});

const finalBody = z.object({
  decision: z.enum([
    'approve',
    'deposit_prepaid',
    'manager_review',
    'pending_docs',
    'declined_customer',
    'decline',
    'decline_blacklist',
  ]),
  approvedLimit: z.coerce.number().min(0).max(99_999_999).optional(),
  note: z.string().trim().max(2000).optional(),
  /**
   * Which arrangement a `deposit_prepaid` outcome is. The status column cannot tell a 1:1 deposit
   * from a prepaid account, and the SOP asks for the conditions to be recorded — so the instrument
   * is part of the decision, not a detail of the note.
   */
  instrument: z.enum(['deposit_1_1', 'prepaid']).optional(),
});

const docRequestBody = z.object({
  phaseCode: z.string().trim().min(1),
  note: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        docType: z.enum(VERIFICATION_DOC_TYPES),
        label: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(20),
});


/** numeric columns take text; null stays null so a factor can be UNSET, not zeroed. */
const numText = (v: number | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : String(v);

export async function verificationFlowRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/flow/cases', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    return deskService.list(ctx, listQuery.parse(request.query));
  });

  app.get<{ Params: { id: string } }>('/verification/flow/cases/:id', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const { id } = idParams.parse(request.params);
    return deskService.detail(ctx, id);
  });

  app.get<{ Params: { id: string } }>('/verification/flow/cases/:id/snapshot', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    return readDeskBrokerSnapshot(ctx, idParams.parse(request.params).id);
  });

  /** READ-gated document open — short-lived link, same as the Sales route. */
  app.get<{ Params: { id: string; documentId: string } }>(
    '/verification/flow/cases/:id/documents/:documentId/download',
    auth,
    async (request) => {
      const ctx = requireVerificationRead(request);
      const { id, documentId } = docParams.parse(request.params);
      const link = await documentService.downloadUrl(ctx, id, documentId);
      await auditFromContext(ctx, {
        action: 'verification.flow.document_downloaded',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { documentId, fileName: link.fileName },
      });
      return link;
    },
  );

  /**
   * Correct the application from the desk.
   *
   * The Sales twin is `POST /verification/applications/:id` and shares this exact body — see the
   * export note on `patchBody`. What differs is the door: this one is verification-write-gated and
   * carries the desk's own rule (`deskService.patchIntake`), which allows a correction at any phase
   * short of a decided case rather than refusing once underwriting starts.
   */
  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/intake',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = intakePatchBody.parse(request.body ?? {});
      const detail = await deskService.patchIntake(ctx, id, body as IntakePatch);
      await auditFromContext(ctx, {
        action: 'verification.flow.intake.corrected',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { fields: Object.keys(body) },
      });
      return detail;
    },
  );

  /**
   * The desk uploading a Phase-1 document, and adding or removing a principal.
   *
   * WHY THESE EXIST. The desk could already CORRECT intake fields (the route above) but not attach
   * a file or add an owner, so a reviewer holding a licence scan that Sales had emailed them had
   * nowhere to put it: the only upload route was Sales-gated and the only "add a principal" route
   * was too. A reviewer had to ask Sales to re-key something the reviewer was already looking at.
   *
   * They are the same service calls the Sales routes make — `documentService` and
   * `applicationService` enforce the case rules — so the desk gets the same validation, the same
   * gate re-evaluation and the same audit trail, through a Verification-gated door.
   */
  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/documents',
    auth,
    async (request, reply) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);

      const files: Array<{ name: string; mime: string; buffer: Buffer }> = [];
      const fields: Record<string, string> = {};
      for await (const part of request.parts({
        limits: { files: MAX_DOCUMENTS_PER_UPLOAD, fileSize: MAX_DOCUMENT_BYTES },
      })) {
        if (part.type === 'file') {
          files.push({
            name: part.filename || 'document',
            mime: part.mimetype || 'application/octet-stream',
            buffer: await part.toBuffer(),
          });
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value;
        }
      }
      if (files.length === 0) {
        throw new AppError('Attach at least one file.', {
          statusCode: 400,
          code: 'NO_FILES',
          expose: true,
        });
      }

      const parsedType = z.enum(VERIFICATION_DOC_TYPES).safeParse(fields.docType);
      const docType = parsedType.success ? parsedType.data : 'other';
      const actorName = ctx.userName || ctx.userId;
      for (const file of files) {
        await documentService.upload(
          ctx,
          id,
          {
            docType,
            label: fields.label,
            fileName: file.name,
            mime: file.mime,
            buffer: file.buffer,
            fulfilsRequestId: fields.fulfilsRequestId,
          },
          actorName,
        );
      }
      await auditFromContext(ctx, {
        action: 'verification.flow.documents_uploaded',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { docType, fileCount: files.length, byDesk: true },
      });
      // Opens the gate when this file was the last outstanding item — see deskPhase1Writes.
      return reply.code(201).send(await afterDeskDocumentUpload(ctx, id));
    },
  );

  /** Desk file remove. Sales twin POST-deletes and refuses after submit; this door allows red. */
  app.delete<{ Params: { id: string; documentId: string } }>(
    '/verification/flow/cases/:id/documents/:documentId',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, documentId } = docParams.parse(request.params);
      await applicationService.assertDeskMayCorrect(ctx, id);
      await documentService.remove(ctx, id, documentId);
      await auditFromContext(ctx, {
        action: 'verification.flow.document_removed',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { documentId, byDesk: true },
      });
      return afterDeskDocumentRemove(ctx, id);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/principals',
    auth,
    async (request, reply) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      // Same destructure as the Sales route: `ownershipPct` validates as a number but stores as
      // numeric text, so spreading it would let the number win over the conversion.
      const { ownershipPct, ...body } = deskPrincipalBody.parse(request.body ?? {});
      await applicationService.addPrincipal(
        ctx,
        id,
        {
          ...body,
          ...(ownershipPct === undefined ? {} : { ownershipPct: String(ownershipPct) }),
        },
        { asDesk: true },
      );
      await auditFromContext(ctx, {
        action: 'verification.flow.principal_added',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { byDesk: true },
      });
      return reply.code(201).send(await deskService.detail(ctx, id));
    },
  );

  app.delete<{ Params: { id: string; principalId: string } }>(
    '/verification/flow/cases/:id/principals/:principalId',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, principalId } = deskPrincipalParams.parse(request.params);
      await applicationService.removePrincipal(ctx, id, principalId, { asDesk: true });
      await auditFromContext(ctx, {
        action: 'verification.flow.principal_removed',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { principalId, byDesk: true },
      });
      return deskService.detail(ctx, id);
    },
  );

  app.post<{ Params: { id: string; phase: string } }>(
    '/verification/flow/cases/:id/phases/:phase/decision',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, phase } = phaseParams.parse(request.params);
      const body = decisionBody.parse(request.body ?? {});
      const detail = await deskService.decidePhase(ctx, id, phase, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.phase_decision',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { phase, outcome: body.outcome, statusCode: detail.case.statusCode },
      });
      return detail;
    },
  );

  /**
   * Reopen a phase — the desk's way back. Sibling of `/decision`, and the reason it is a POST with a
   * body rather than a DELETE on the decision: the REASON is required and belongs in the request, not
   * in a query string that ends up in an access log.
   */
  app.post<{ Params: { id: string; phase: string } }>(
    '/verification/flow/cases/:id/phases/:phase/reopen',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, phase } = phaseParams.parse(request.params);
      const body = reopenBody.parse(request.body ?? {});
      const detail = await deskService.reopenPhase(ctx, id, phase, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.phase_reopened',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        // The reason is on the case timeline as the event note; it is audited here too because this
        // withdraws a decision somebody else recorded.
        detail: { phase, reason: body.reason, statusCode: detail.case.statusCode },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/screening/run',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      return deskService.runScreening(ctx, id);
    },
  );

  app.post<{ Params: { id: string; hitId: string } }>(
    '/verification/flow/cases/:id/screening/:hitId/verdict',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, hitId } = hitParams.parse(request.params);
      const body = verdictBody.parse(request.body ?? {});
      const detail = await deskService.setScreeningVerdict(ctx, id, hitId, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.screening_verdict',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { hitId, verdict: body.verdict },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/credit-review',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = creditBody.parse(request.body ?? {});
      return deskService.saveCreditReview(ctx, id, {
        ...body,
        totalDebt: numText(body.totalDebt),
        utilizationPct: numText(body.utilizationPct),
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/banking-review',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = bankingBody.parse(request.body ?? {});
      // Every money field crosses as text; `avgWeeklyNetCashFlow` is deliberately NOT accepted from
      // the client — the service derives it from the two recurring inputs.
      return deskService.saveBankingReview(ctx, id, {
        ...body,
        monthlyRevenue: numText(body.monthlyRevenue),
        weeklyRevenue: numText(body.weeklyRevenue),
        recurringWeeklyIncome: numText(body.recurringWeeklyIncome),
        recurringWeeklyExpenses: numText(body.recurringWeeklyExpenses),
        avgMonthlyNetCashFlow: numText(body.avgMonthlyNetCashFlow),
        avgDailyBalance: numText(body.avgDailyBalance),
        endingBalance: numText(body.endingBalance),
        minimumBalance: numText(body.minimumBalance),
        avgWeeklyFuelExpense: numText(body.avgWeeklyFuelExpense),
        existingDebtPayments: numText(body.existingDebtPayments),
        oneTimeDeposits: numText(body.oneTimeDeposits),
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/risk',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = riskBody.parse(request.body ?? {});
      const detail = await deskService.saveRiskAssessment(ctx, id, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.risk_assessed',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: {
          riskTier: body.riskTier,
          recommendedLimit: detail.risk?.recommendedLimit ?? null,
        },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/documents/request',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = docRequestBody.parse(request.body ?? {});
      const detail = await deskService.requestDocuments(ctx, id, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.documents_requested',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { phase: body.phaseCode, count: body.items.length },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/documents/resume',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      return deskService.resumeAfterDocuments(ctx, id);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/decision',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = finalBody.parse(request.body ?? {});
      const detail = await deskService.decide(ctx, id, {
        decision: body.decision,
        ...(body.approvedLimit === undefined ? {} : { approvedLimit: body.approvedLimit }),
        ...(body.note === undefined ? {} : { note: body.note }),
        ...(body.instrument === undefined ? {} : { instrument: body.instrument }),
      });
      await auditFromContext(ctx, {
        action: 'verification.flow.decision',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: {
          decision: body.decision,
          approvedLimit: body.approvedLimit ?? null,
          instrument: body.instrument ?? null,
          statusCode: detail.case.statusCode,
        },
      });
      return detail;
    },
  );

}
