/**
 * Verification Mytrion → verification cases (`/v1/verification/cases*`).
 * Distinct from Sales `/verification/clients` and the DWH roster `/verification/roster`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  approveVerificationCaseStage,
  decideVerificationCase,
  getVerificationCase,
  listVerificationCases,
  refreshVerificationCase,
  resetVerificationCaseStage,
  runVerificationCaseStage,
} from '../../modules/verification/verificationCases.js';
import { insertBankStatementFiles, isWriteConfigured } from '../../integrations/creditPlatformWriteDb.js';
import { stampMytrionAgent } from '../../integrations/creditPlatformInboxWrites.js';
import { verificationDb } from '../../integrations/verificationDb.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { VERIFICATION_CASE_STATUSES } from '../../db/schema/verification_cases.js';
import { VERIFICATION_OWNER_SCOPES } from '../../modules/verification/verificationCaseDesk.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification cases');
}

function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification cases');
}

const listQuery = z.object({
  status: z.enum(VERIFICATION_CASE_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  unmatched: z.enum(['0', '1', 'true', 'false']).optional(),
  owner: z.enum(VERIFICATION_OWNER_SCOPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const runBody = z.object({
  bureauProvider: z.string().trim().max(64).optional(),
});

const idParams = z.object({ id: z.string().min(1).max(80) });
const stageParams = z.object({
  id: z.string().min(1).max(80),
  stageId: z.string().min(1).max(64),
});
const noteBody = z.object({ note: z.string().max(2000).optional() });
const decisionBody = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'REVIEW']),
  reason: z.string().max(2000).optional(),
});

export async function verificationCasesRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/cases', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const query = listQuery.parse(request.query);
    return listVerificationCases(ctx, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { query: query.q } : {}),
      unmatched: query.unmatched === '1' || query.unmatched === 'true',
      ...(query.owner ? { owner: query.owner } : {}),
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.get<{ Params: { id: string } }>('/verification/cases/:id', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const { id } = idParams.parse(request.params);
    return getVerificationCase(ctx, id);
  });

  app.post<{ Params: { id: string } }>('/verification/cases/:id/refresh', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const { id } = idParams.parse(request.params);
    return refreshVerificationCase(ctx, id);
  });

  app.post<{ Params: { id: string; stageId: string } }>(
    '/verification/cases/:id/stages/:stageId/run',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, stageId } = stageParams.parse(request.params);
      const body = runBody.parse(request.body ?? {});
      return runVerificationCaseStage(ctx, id, stageId, {
        ...(body.bureauProvider ? { bureauProvider: body.bureauProvider } : {}),
      });
    },
  );

  app.post<{ Params: { id: string; stageId: string } }>(
    '/verification/cases/:id/stages/:stageId/approve',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, stageId } = stageParams.parse(request.params);
      const body = noteBody.parse(request.body ?? {});
      return approveVerificationCaseStage(ctx, id, stageId, body.note);
    },
  );

  app.post<{ Params: { id: string } }>('/verification/cases/:id/decision', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    const { id } = idParams.parse(request.params);
    const body = decisionBody.parse(request.body ?? {});
    return decideVerificationCase(ctx, id, body.decision, body.reason);
  });

  app.post<{ Params: { id: string; stageId: string } }>(
    '/verification/cases/:id/stages/:stageId/reset',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, stageId } = stageParams.parse(request.params);
      return resetVerificationCaseStage(ctx, id, stageId);
    },
  );

  app.post<{ Params: { id: string } }>('/verification/cases/:id/attachments', auth, async (request) => {
    const ctx = requireVerificationWrite(request);
    if (!isWriteConfigured()) {
      throw new AppError('The verification write-back path is not enabled.', {
        statusCode: 503,
        code: 'VERIFICATION_WRITE_DISABLED',
        expose: true,
      });
    }
    const { id } = idParams.parse(request.params);
    const detail = await getVerificationCase(ctx, id, { sync: false });
    const requestId = detail.case.requestId;
    if (!requestId) {
      throw new AppError('This case is not bound to a credit-platform request yet.', {
        statusCode: 409,
        code: 'VERIFICATION_REQUEST_UNBOUND',
        expose: true,
      });
    }
    const files: Array<{ name: string; mime: string; buffer: Buffer }> = [];
    for await (const part of request.parts({ limits: { files: 20, fileSize: 20 * 1024 * 1024 } })) {
      if (part.type === 'file') {
        files.push({
          name: part.filename || 'bank-statement',
          mime: part.mimetype || 'application/octet-stream',
          buffer: await part.toBuffer(),
        });
      }
    }
    if (!files.length) {
      throw new AppError('Attach at least one file.', { statusCode: 400, code: 'NO_FILES', expose: true });
    }
    const agent = stampMytrionAgent(ctx.userName || ctx.userId || 'system');
    const { ids } = await insertBankStatementFiles({
      requestId,
      agent,
      batchId: `verification:${requestId}:${Date.now()}`,
      files: files.map((file) => ({
        fileName: file.name,
        contentType: file.mime,
        content: file.buffer,
      })),
    });
    await auditFromContext(ctx, {
      action: 'verification.case.attachments_uploaded',
      status: 'ok',
      resourceType: 'verification_case',
      resourceId: id,
      detail: { requestId, fileCount: files.length, inboxIds: ids },
    });
    return { status: 'queued', uploaded: ids.length, inboxIds: ids };
  });

  app.get<{ Params: { id: string; attachmentId: string } }>(
    '/verification/cases/:id/attachments/:attachmentId/download',
    auth,
    async (request, reply) => {
      const ctx = requireVerificationRead(request);
      const { id } = idParams.parse(request.params);
      const attachmentId = Number((request.params as { attachmentId: string }).attachmentId);
      if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
        throw new AppError('Invalid attachment id.', {
          statusCode: 400,
          code: 'INVALID_ATTACHMENT_ID',
          expose: true,
        });
      }
      const detail = await getVerificationCase(ctx, id, { sync: false });
      const requestId = detail.case.requestId;
      if (!requestId) {
        throw new AppError('File not found.', { statusCode: 404, code: 'ATTACHMENT_NOT_FOUND', expose: true });
      }
      const rows = await verificationDb.query<{
        content: Buffer;
        file_name: string;
        content_type: string;
        request_id: string;
      }>(
        'select content, file_name, content_type, request_id from file_attachments where id = $1',
        [attachmentId],
      );
      const row = rows[0];
      if (!row || row.request_id !== requestId) {
        throw new AppError('File not found.', { statusCode: 404, code: 'ATTACHMENT_NOT_FOUND', expose: true });
      }
      const buffer = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
      const safeName = (row.file_name || `attachment-${attachmentId}`).replace(/["\r\n]/g, '');
      return reply
        .header('Content-Type', row.content_type || 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${safeName}"`)
        .send(buffer);
    },
  );
}
