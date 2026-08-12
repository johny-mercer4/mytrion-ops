/**
 * Sales Verification WRITE-back (/v1/verification/applicant, /v1/verification/bank-statements) — the
 * two owner-scoped write endpoints for the Sales verification tab. Both INSERT into credit_platform's
 * kxd.sales_agent_* inbox (via creditPlatformWriteDb); a flag-gated credit-platform consumer applies
 * them. Kept in its own file: verificationPipeline.routes.ts is already large, and the multi-file
 * reader here needs its OWN multipart cap, distinct from readResponseUpload's hard files:1.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { getPipelineProvider } from '../../modules/verificationPipeline/provider.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import { fetchDealOwnerId } from '../../integrations/salesDataCenter.js';
import { verificationDb } from '../../integrations/verificationDb.js';
import {
  insertApplicantUpdate,
  insertBankStatementFiles,
  insertPlaidLinkAction,
  isWriteConfigured,
} from '../../integrations/creditPlatformWriteDb.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;

const APPLICANT_FIELDS = [
  'firstName', 'lastName', 'address', 'city', 'state', 'zipCode',
  'dateOfBirth', 'email', 'phone', 'dotNumber', 'mcNumber',
] as const;

const applicantBody = z.object({
  requestId: z.string().min(1).max(120),
  dealId: z.string().regex(/^\d+$/),
  changes: z.record(z.string().max(300)),
});

const plaidLinkBody = z.object({
  requestId: z.string().min(1).max(120),
  dealId: z.string().regex(/^\d+$/),
  regenerate: z.boolean().optional(),
});

interface UploadFile {
  name: string;
  mime: string;
  buffer: Buffer;
}

function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Verification Pipeline');
}

function ensureWriteConfigured(): void {
  if (!isWriteConfigured()) {
    throw new AppError('The verification write-back path is not enabled.', {
      statusCode: 503,
      code: 'VERIFICATION_WRITE_DISABLED',
      expose: true,
    });
  }
}

/**
 * Confirm the caller may write to this case: the deal must resolve to a credit_platform request whose
 * request_id matches, AND (unless admin/allDepartmentAccess) the deal must be owned by the caller.
 * Returns the agent label to stamp on the inbox row. Mirrors the /verification/responses gate.
 */
async function authorizeWrite(ctx: TenantContext, requestId: string, dealId: string): Promise<string> {
  const ownerId = resolveZohoUserId(ctx);
  const dealOwnerId = await fetchDealOwnerId(dealId).catch(() => null);
  if (!dealOwnerId || (!ctx.allDepartmentAccess && dealOwnerId !== ownerId)) {
    throw new AppError('This verification request is not assigned to you.', {
      statusCode: 403,
      code: 'VERIFICATION_DEAL_FORBIDDEN',
      expose: true,
    });
  }
  const snapshot = await getPipelineProvider().getPipeline({ dealId });
  if (!snapshot || snapshot.requestId !== requestId) {
    throw new AppError('Verification request was not found for this deal.', {
      statusCode: 404,
      code: 'VERIFICATION_REQUEST_NOT_FOUND',
      expose: true,
    });
  }
  return ctx.userName || ownerId;
}

async function readMultipleUploads(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; files: UploadFile[] }> {
  const fields: Record<string, string> = {};
  const files: UploadFile[] = [];
  try {
    for await (const part of request.parts({ limits: { files: MAX_FILES, fileSize: MAX_ATTACHMENT_BYTES } })) {
      if (part.type === 'file') {
        files.push({
          name: part.filename || 'bank-statement',
          mime: part.mimetype || 'application/octet-stream',
          buffer: await part.toBuffer(),
        });
      } else {
        fields[part.fieldname] = typeof part.value === 'string' ? part.value : String(part.value ?? '');
      }
    }
  } catch (err) {
    if (err instanceof Error && /file too large|FST_REQ_FILE_TOO_LARGE|request file too large/i.test(err.message)) {
      throw new AppError('An attachment exceeds the 20MB limit.', {
        statusCode: 413,
        code: 'ATTACHMENT_TOO_LARGE',
        expose: true,
      });
    }
    throw err;
  }
  return { fields, files };
}

export async function verificationWritebackRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.post('/verification/applicant', guard, async (request) => {
    ensureWriteConfigured();
    const ctx = requireSalesAccess(request);
    const body = applicantBody.parse(request.body);
    const changes: Record<string, string> = {};
    for (const field of APPLICANT_FIELDS) {
      const value = body.changes[field]?.trim();
      if (value) changes[field] = value;
    }
    if (!Object.keys(changes).length) {
      throw new AppError('No applicant fields to update.', {
        statusCode: 400,
        code: 'NO_APPLICANT_CHANGES',
        expose: true,
      });
    }
    const agent = await authorizeWrite(ctx, body.requestId, body.dealId);
    const { id } = await insertApplicantUpdate({ requestId: body.requestId, agent, changes });
    await auditFromContext(ctx, {
      action: 'sales.verification.applicant_edit_queued',
      status: 'ok',
      resourceType: 'verification_request',
      resourceId: body.requestId,
      detail: { dealId: body.dealId, fields: Object.keys(changes), inboxId: id },
    });
    return { status: 'queued', inboxId: id, fields: Object.keys(changes) };
  });

  app.post('/verification/bank-statements', guard, async (request) => {
    ensureWriteConfigured();
    const ctx = requireSalesAccess(request);
    const { fields, files } = await readMultipleUploads(request);
    const requestId = (fields.requestId || '').trim();
    const dealId = (fields.dealId || '').trim();
    if (!requestId || !/^\d+$/.test(dealId)) {
      throw new AppError('requestId and a numeric dealId are required.', {
        statusCode: 400,
        code: 'INVALID_UPLOAD_FIELDS',
        expose: true,
      });
    }
    if (!files.length) {
      throw new AppError('Attach at least one bank statement.', {
        statusCode: 400,
        code: 'NO_FILES',
        expose: true,
      });
    }
    const agent = await authorizeWrite(ctx, requestId, dealId);
    const batchId = `sales:${requestId}:${Date.now()}`;
    const { ids } = await insertBankStatementFiles({
      requestId,
      agent,
      batchId,
      files: files.map((f) => ({ fileName: f.name, contentType: f.mime, content: f.buffer })),
    });
    await auditFromContext(ctx, {
      action: 'sales.verification.bank_statements_uploaded',
      status: 'ok',
      resourceType: 'verification_request',
      resourceId: requestId,
      detail: { dealId, fileCount: files.length, inboxIds: ids },
    });
    return { status: 'queued', uploaded: ids.length, inboxIds: ids };
  });

  app.post('/verification/plaid-link', guard, async (request) => {
    ensureWriteConfigured();
    const ctx = requireSalesAccess(request);
    const body = plaidLinkBody.parse(request.body);
    const agent = await authorizeWrite(ctx, body.requestId, body.dealId);
    const { id } = await insertPlaidLinkAction({ requestId: body.requestId, agent, ...(body.regenerate ? { regenerate: true } : {}) });
    await auditFromContext(ctx, {
      action: 'sales.verification.plaid_link_queued',
      status: 'ok',
      resourceType: 'verification_request',
      resourceId: body.requestId,
      detail: { dealId: body.dealId, regenerate: !!body.regenerate, inboxId: id },
    });
    return { status: 'queued', inboxId: id };
  });

  app.get('/verification/attachments/:id/download', guard, async (request, reply) => {
    const ctx = requireSalesAccess(request);
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('Invalid attachment id.', { statusCode: 400, code: 'INVALID_ATTACHMENT_ID', expose: true });
    }
    const rows = await verificationDb.query<{ content: Buffer; file_name: string; content_type: string; request_id: string }>(
      'select content, file_name, content_type, request_id from file_attachments where id = $1',
      [id],
    );
    const row = rows[0];
    if (!row) {
      throw new AppError('File not found.', { statusCode: 404, code: 'ATTACHMENT_NOT_FOUND', expose: true });
    }
    const ownerId = resolveZohoUserId(ctx);
    const dealOwnerId = await fetchDealOwnerId(row.request_id).catch(() => null);
    if (!ctx.allDepartmentAccess && (!dealOwnerId || dealOwnerId !== ownerId)) {
      throw new AppError('This file is not on one of your deals.', { statusCode: 403, code: 'ATTACHMENT_FORBIDDEN', expose: true });
    }
    const buffer = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
    const safeName = (row.file_name || `attachment-${id}`).replace(/["\r\n]/g, '');
    return reply
      .header('Content-Type', row.content_type || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${safeName}"`)
      .send(buffer);
  });
}
