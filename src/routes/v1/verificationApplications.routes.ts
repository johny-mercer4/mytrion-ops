/**
 * Sales-facing application intake — the pre-Phase-1 half of the shared verification case.
 *
 * Gated on the SALES department, not verification: this is the Sales Mytrion's surface onto the same
 * `verification_cases` row the Verification desk underwrites, exactly as `retention.*` gives Sales
 * and Customer Service different doors onto one `retention_cases` row.
 *
 * Routes stay thin. Completeness, the red/green gate and every ownership rule live in
 * `modules/verificationFlow/applicationService.ts`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  applicationService,
  type IntakePatch,
} from '../../modules/verificationFlow/applicationService.js';
import {
  documentService,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
} from '../../modules/verificationFlow/documentService.js';
import {
  VERIFICATION_APPLICANT_TYPES,
  VERIFICATION_BANKING_SOURCES,
  VERIFICATION_DOC_TYPES,
} from '../../db/schema/verification_flow.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

/** Sales owns intake; the Verification desk reads these same rows through its own routes. */
function requireSales(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Verification applications');
}

const idParams = z.object({ id: z.string().min(1) });
const docParams = z.object({ id: z.string().min(1), documentId: z.string().min(1) });
const principalParams = z.object({ id: z.string().min(1), principalId: z.string().min(1) });

const createBody = z.object({
  applicantType: z.enum(VERIFICATION_APPLICANT_TYPES).optional(),
  companyName: z.string().trim().min(1).max(200).optional(),
});

/** Empty strings clear a field; the wizard sends them when an agent deletes a value. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const digitsOnly = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .refine((v) => v === null || /^\d+$/.test(v), `${label} must be digits only`)
    .nullable()
    .optional();

/**
 * The intake patch shape, EXPORTED — the Verification desk corrects the same columns through its
 * own route (`POST /verification/flow/cases/:id/intake`) and must accept exactly the same body.
 * Two copies of this schema would drift the first time a field's validation changed on one desk.
 */
export const patchBody = z.object({
  applicantType: z.enum(VERIFICATION_APPLICANT_TYPES).optional(),
  companyName: nullableText(200),
  firstName: nullableText(100),
  lastName: nullableText(100),
  email: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v.length === 0 ? null : v))
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email address')
    .nullable()
    .optional(),
  phone: nullableText(40),
  dateOfBirth: nullableText(20),
  // Last 4 only — the full SSN and licence live as documents, never as a column.
  ssnLast4: digitsOnly(4, 'SSN last 4'),
  dlLast4: nullableText(8),
  dlState: nullableText(4),
  residentialAddress: nullableText(300),
  businessAddress: nullableText(300),
  ein: nullableText(20),
  mc: nullableText(20),
  dot: nullableText(20),
  trucksCount: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  fuelCardsRequested: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  requestedLimit: z
    .union([z.coerce.number().min(0).max(99_999_999), z.literal('')])
    .transform((v) => (v === '' ? null : String(v)))
    .nullable()
    .optional(),
  bankingSource: z.enum(VERIFICATION_BANKING_SOURCES).nullable().optional(),
  plaidConnected: z.boolean().optional(),
});

const principalBody = z.object({
  fullName: z.string().trim().min(1).max(200),
  role: z.string().trim().max(100).optional(),
  ownershipPct: z.coerce.number().min(0).max(100).optional(),
  dateOfBirth: z.string().trim().max(20).optional(),
  ssnLast4: z.string().trim().regex(/^\d{4}$/, 'SSN last 4 must be 4 digits').optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  statusCode: z.string().trim().min(1).optional(),
  gate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export async function verificationApplicationsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/applications', auth, async (request) => {
    const ctx = requireSales(request);
    const query = listQuery.parse(request.query);
    return applicationService.listForAgent(ctx, query);
  });

  app.get<{ Params: { id: string } }>('/verification/applications/:id', auth, async (request) => {
    const ctx = requireSales(request);
    const { id } = idParams.parse(request.params);
    return applicationService.get(ctx, id);
  });

  /**
   * Manual create — ADMIN ONLY, and not part of the normal flow.
   *
   * Applications come from the Zoho Deal poller (`automation.verification.case-ingest`); a Sales
   * agent does not start one. This stays as a backfill and support escape hatch — a Deal that never
   * polled, a test fixture — behind the admin role so it cannot become a second, divergent way for
   * applications to exist.
   */
  app.post(
    '/verification/applications',
    { onRequest: [app.authenticate], preHandler: [app.requireRole('admin')] },
    async (request, reply) => {
    const ctx = requireSales(request);
    const body = createBody.parse(request.body ?? {});
    const detail = await applicationService.create(ctx, {
      ...body,
      ownerName: ctx.userName || ctx.userId,
    });
    await auditFromContext(ctx, {
      action: 'verification.application.created',
      status: 'ok',
      resourceType: 'verification_case',
      resourceId: detail.case.id,
      detail: { applicantType: detail.case.applicantType, manual: true },
    });
    return reply.code(201).send(detail);
    },
  );

  app.post<{ Params: { id: string } }>('/verification/applications/:id', auth, async (request) => {
    const ctx = requireSales(request);
    const { id } = idParams.parse(request.params);
    const body = patchBody.parse(request.body ?? {});
    // The global empty-JSON-body parser accepts `{}`; an empty patch is a no-op read, not an error.
    const detail = await applicationService.patch(ctx, id, body as IntakePatch);
    await auditFromContext(ctx, {
      action: 'verification.application.updated',
      status: 'ok',
      resourceType: 'verification_case',
      resourceId: id,
      detail: { fields: Object.keys(body), complete: detail.intake.complete },
    });
    return detail;
  });

  app.post<{ Params: { id: string } }>(
    '/verification/applications/:id/principals',
    auth,
    async (request, reply) => {
      const ctx = requireSales(request);
      const { id } = idParams.parse(request.params);
      // `ownershipPct` is parsed as a number for validation but stored as numeric text, so it is
      // destructured out rather than spread — otherwise the number would win over the conversion.
      const { ownershipPct, ...body } = principalBody.parse(request.body ?? {});
      const detail = await applicationService.addPrincipal(ctx, id, {
        ...body,
        ...(ownershipPct === undefined ? {} : { ownershipPct: String(ownershipPct) }),
      });
      return reply.code(201).send(detail);
    },
  );

  app.post<{ Params: { id: string; principalId: string } }>(
    '/verification/applications/:id/principals/:principalId/delete',
    auth,
    async (request) => {
      const ctx = requireSales(request);
      const { id, principalId } = principalParams.parse(request.params);
      return applicationService.removePrincipal(ctx, id, principalId);
    },
  );

  /**
   * Multipart upload straight to the Verification Dropbox root. `request.parts()` rather than
   * `request.file()` so a form can carry both the files and their `docType`, the same reason
   * `commsAttachments.routes.ts` does.
   */
  app.post<{ Params: { id: string } }>(
    '/verification/applications/:id/documents',
    auth,
    async (request, reply) => {
      const ctx = requireSales(request);
      const { id } = idParams.parse(request.params);
      await applicationService.assertSalesMayEdit(ctx, id);

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
        action: 'verification.application.documents_uploaded',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { docType, fileCount: files.length },
      });

      // Uploading a bank statement can complete the application, so the caller gets the refreshed
      // gate rather than having to re-fetch to learn the card turned green.
      const detail = await applicationService.get(ctx, id);
      return reply.code(201).send(detail);
    },
  );

  app.get<{ Params: { id: string; documentId: string } }>(
    '/verification/applications/:id/documents/:documentId/download',
    auth,
    async (request) => {
      const ctx = requireSales(request);
      const { id, documentId } = docParams.parse(request.params);
      return documentService.downloadUrl(ctx, id, documentId);
    },
  );

  app.post<{ Params: { id: string; documentId: string } }>(
    '/verification/applications/:id/documents/:documentId/delete',
    auth,
    async (request) => {
      const ctx = requireSales(request);
      const { id, documentId } = docParams.parse(request.params);
      await applicationService.assertSalesMayEdit(ctx, id);
      await documentService.remove(ctx, id, documentId);
      return applicationService.get(ctx, id);
    },
  );

  /** The gate flip. Refuses with the outstanding list rather than a generic rejection. */
  app.post<{ Params: { id: string } }>(
    '/verification/applications/:id/submit',
    auth,
    async (request) => {
      const ctx = requireSales(request);
      const { id } = idParams.parse(request.params);
      const detail = await applicationService.submit(ctx, id);
      await auditFromContext(ctx, {
        action: 'verification.application.submitted',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: {
          applicantType: detail.case.applicantType,
          route: detail.underwritingRoute,
          statusCode: detail.case.statusCode,
        },
      });
      return detail;
    },
  );
}
