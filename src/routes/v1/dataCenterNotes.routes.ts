/** Sales Data Center note routes — record scope, note ownership, user-attributed writes, and audit. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { fetchDealOwnerId, fetchLeadOwnerId } from '../../integrations/salesDataCenter.js';
import { attachFileAsUser, zohoActorId } from '../../integrations/zohoUserAuth.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  createRecordNote,
  deleteRecordNote,
  fetchRecordNotes,
  updateRecordNote,
  type CrmModule,
} from '../../modules/sales/recordActivity.js';
import type { TenantContext } from '../../types/tenantContext.js';

type FetchOwner = (id: string) => Promise<string | null>;
type AssertOwnedRecord = (
  request: FastifyRequest,
  module: CrmModule,
  fetchOwner: FetchOwner,
) => Promise<{ ctx: TenantContext; id: string }>;

const noteParam = z.object({
  id: z.string().regex(/^\d+$/, 'id must be a CRM record id').max(60),
  noteId: z.string().regex(/^\d+$/, 'noteId must be a CRM record id').max(60),
});
const noteEditBody = z
  .object({
    title: z.string().max(255),
    content: z.string().max(32_000),
  })
  .strict()
  .refine((value) => value.content.trim().length > 0, {
    message: 'A note requires content.',
    path: ['content'],
  });

const MAX_NOTE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function readNoteUpload(request: FastifyRequest): Promise<{
  fields: Record<string, string>;
  file: { name: string; mime: string; buffer: Buffer } | null;
}> {
  const fields: Record<string, string> = {};
  let file: { name: string; mime: string; buffer: Buffer } | null = null;
  try {
    for await (const part of request.parts({
      limits: { fileSize: MAX_NOTE_ATTACHMENT_BYTES, files: 1 },
    })) {
      if (part.type === 'file') {
        file = {
          name: part.filename || 'attachment',
          mime: part.mimetype || 'application/octet-stream',
          buffer: await part.toBuffer(),
        };
      } else {
        fields[part.fieldname] =
          typeof part.value === 'string' ? part.value : String(part.value ?? '');
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      /file too large|FST_REQ_FILE_TOO_LARGE|request file too large/i.test(err.message)
    ) {
      throw new AppError('Attachment exceeds the 20MB limit.', {
        statusCode: 413,
        code: 'ATTACHMENT_TOO_LARGE',
        expose: true,
      });
    }
    throw err;
  }
  return { fields, file };
}

function crmError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError('Zoho CRM request failed', {
    statusCode: 502,
    code: 'ZOHO_CRM_ERROR',
    cause: err,
    expose: true,
  });
}

function auditResource(module: CrmModule): 'crm_lead' | 'crm_deal' {
  return module === 'Leads' ? 'crm_lead' : 'crm_deal';
}

export async function registerDataCenterNoteRoutes(
  app: FastifyInstance,
  assertOwnedRecord: AssertOwnedRecord,
): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  async function listNotes(request: FastifyRequest, module: CrmModule, fetchOwner: FetchOwner) {
    const { ctx, id } = await assertOwnedRecord(request, module, fetchOwner);
    try {
      return { notes: await fetchRecordNotes(module, id, ctx) };
    } catch (err) {
      throw crmError(err);
    }
  }

  async function logRecordNote(
    request: FastifyRequest,
    module: CrmModule,
    fetchOwner: FetchOwner,
  ): Promise<{ id: string; hasAttachment: boolean }> {
    const { ctx, id } = await assertOwnedRecord(request, module, fetchOwner);
    const { fields, file } = await readNoteUpload(request);
    const content = (fields.content ?? '').trim();
    if (!content) {
      throw new AppError('A note requires content.', {
        statusCode: 400,
        code: 'NO_CONTENT',
        expose: true,
      });
    }
    let noteId: string;
    try {
      noteId = await createRecordNote(
        module,
        id,
        { content, ...(fields.title?.trim() ? { title: fields.title.trim() } : {}) },
        ctx,
      );
    } catch (err) {
      const mapped = crmError(err);
      await auditFromContext(ctx, {
        action: 'sales.datacenter.note_create',
        status: 'error',
        resourceType: auditResource(module),
        resourceId: id,
        detail: { code: mapped.code },
      });
      throw mapped;
    }
    if (file) {
      try {
        await attachFileAsUser(
          ctx.tenantId,
          zohoActorId(ctx),
          'Notes',
          noteId,
          file.name,
          file.buffer,
          file.mime,
        );
      } catch (err) {
        request.log.warn({ err }, 'note attachment upload failed (note saved)');
      }
    }
    await auditFromContext(ctx, {
      action: 'sales.datacenter.note_create',
      status: 'ok',
      resourceType: auditResource(module),
      resourceId: id,
      detail: { noteId, hasAttachment: Boolean(file) },
    });
    return { id: noteId, hasAttachment: Boolean(file) };
  }

  async function editRecordNote(
    request: FastifyRequest,
    module: CrmModule,
    fetchOwner: FetchOwner,
  ): Promise<{ id: string; updatedFields: string[] }> {
    const { ctx, id } = await assertOwnedRecord(request, module, fetchOwner);
    const { noteId } = noteParam.parse(request.params);
    const body = noteEditBody.parse(request.body);
    try {
      await updateRecordNote(ctx, module, id, noteId, {
        title: body.title,
        content: body.content.trim(),
      });
    } catch (err) {
      const mapped = crmError(err);
      await auditFromContext(ctx, {
        action: 'sales.datacenter.note_update',
        status: 'error',
        resourceType: auditResource(module),
        resourceId: id,
        detail: { noteId, code: mapped.code },
      });
      throw mapped;
    }
    const updatedFields = ['Note_Title', 'Note_Content'];
    await auditFromContext(ctx, {
      action: 'sales.datacenter.note_update',
      status: 'ok',
      resourceType: auditResource(module),
      resourceId: id,
      detail: { noteId, fields: updatedFields },
    });
    return { id: noteId, updatedFields };
  }

  async function removeRecordNote(
    request: FastifyRequest,
    module: CrmModule,
    fetchOwner: FetchOwner,
  ): Promise<{ id: string; deleted: true }> {
    const { ctx, id } = await assertOwnedRecord(request, module, fetchOwner);
    const { noteId } = noteParam.parse(request.params);
    try {
      await deleteRecordNote(ctx, module, id, noteId);
    } catch (err) {
      const mapped = crmError(err);
      await auditFromContext(ctx, {
        action: 'sales.datacenter.note_delete',
        status: 'error',
        resourceType: auditResource(module),
        resourceId: id,
        detail: { noteId, code: mapped.code },
      });
      throw mapped;
    }
    await auditFromContext(ctx, {
      action: 'sales.datacenter.note_delete',
      status: 'ok',
      resourceType: auditResource(module),
      resourceId: id,
      detail: { noteId },
    });
    return { id: noteId, deleted: true };
  }

  app.get('/data-center/leads/:id/notes', guard, (request) =>
    listNotes(request, 'Leads', fetchLeadOwnerId),
  );
  app.get('/data-center/deals/:id/notes', guard, (request) =>
    listNotes(request, 'Deals', fetchDealOwnerId),
  );
  app.post('/data-center/leads/:id/notes', guard, (request) =>
    logRecordNote(request, 'Leads', fetchLeadOwnerId),
  );
  app.post('/data-center/deals/:id/notes', guard, (request) =>
    logRecordNote(request, 'Deals', fetchDealOwnerId),
  );
  app.patch('/data-center/leads/:id/notes/:noteId', guard, (request) =>
    editRecordNote(request, 'Leads', fetchLeadOwnerId),
  );
  app.patch('/data-center/deals/:id/notes/:noteId', guard, (request) =>
    editRecordNote(request, 'Deals', fetchDealOwnerId),
  );
  app.delete('/data-center/leads/:id/notes/:noteId', guard, (request) =>
    removeRecordNote(request, 'Leads', fetchLeadOwnerId),
  );
  app.delete('/data-center/deals/:id/notes/:noteId', guard, (request) =>
    removeRecordNote(request, 'Deals', fetchDealOwnerId),
  );
}
