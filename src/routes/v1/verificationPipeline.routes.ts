/**
 * Sales "Verification Pipeline" tab (/v1/verification) — the agent's applications, read from Zoho
 * CRM Deals (COQL, freshest application date first) + a per-client compliance-pipeline snapshot.
 *
 * Session-authoritative + owner-scoped exactly like /v1/data-center: a non-admin sees only their own
 * deals; an admin (or act-as) may pass ?zoho_user_id. Scoping is now by Zoho USER ID alone — the old
 * DWH source keyed on an agent display name, so this route had to resolve a name for the warehouse's
 * fallback arm and an agent whose name did not match got an empty pipeline.
 *
 * Pipeline snapshots are read from the credit_platform replica; Sales responses are sent through the
 * source Zoho Deal and journaled in Octane.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { listAgentVerificationDeals } from '../../modules/verificationPipeline/service.js';
import { getPipelineProvider } from '../../modules/verificationPipeline/provider.js';
import { getLiveVerificationSummaries } from '../../modules/verificationPipeline/cardSummary.js';
import type { VerificationCardSummary } from '../../modules/verificationPipeline/types.js';
import { deriveZohoState } from '../../modules/verificationPipeline/types.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import { fetchDealOwnerId } from '../../integrations/salesDataCenter.js';
import {
  attachFileAsUser,
  updateRecordAsUser,
  zohoActorId,
} from '../../integrations/zohoUserAuth.js';
import { createRecordNote } from '../../modules/sales/recordActivity.js';
import { verificationSalesResponseRepo } from '../../repos/verificationSalesResponseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';
import { AsyncSWRCache } from '../../lib/asyncSWRCache.js';

const verificationPageCache = new AsyncSWRCache(300);

function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Verification Pipeline');
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

const scopeQuery = z.object({
  zoho_user_id: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(24).default(9),
  q: z.string().trim().max(120).optional(),
  state: z.enum(['all', 'in_progress', 'approved', 'rejected']).default('all'),
});
const pipelineQuery = z.object({
  dealId: z.string().max(64).optional(),
  carrierId: z.string().max(64).optional(),
  applicationId: z.string().max(64).optional(),
  dot: z.string().max(64).optional(),
});

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const responseFields = z.object({
  requestId: z.string().min(1).max(120),
  dealId: z.string().regex(/^\d+$/),
  externalEventId: z.string().min(1).max(120),
  values: z.string().max(40_000),
  note: z.string().max(10_000).optional(),
});

interface UploadFile {
  name: string;
  mime: string;
  buffer: Buffer;
}

async function readResponseUpload(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; file: UploadFile | null }> {
  const fields: Record<string, string> = {};
  let file: UploadFile | null = null;
  try {
    for await (const part of request.parts({
      limits: { files: 1, fileSize: MAX_ATTACHMENT_BYTES },
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

function responseDto(row: Awaited<ReturnType<typeof verificationSalesResponseRepo.create>>) {
  return {
    sentAt: row.createdAt.toISOString(),
    sentBy: row.ownerZohoUserId,
    attachmentName: row.attachmentName,
    warning: row.syncWarning,
  };
}

function crmKnownFields(values: Record<string, string>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (['mc', 'mc_number', 'motor_carrier', 'motor_carrier_number'].includes(normalized)) {
      updates.MC = value;
    }
    if (['dot', 'dot_number', 'usdot', 'usdot_number'].includes(normalized)) {
      updates.DOT = /^\d+$/.test(value) ? Number(value) : value;
    }
  }
  return updates;
}

function noteContent(input: {
  requestId: string;
  requirementTitle: string;
  userName: string;
  values: Record<string, string>;
  labels: Map<string, string>;
  note: string;
}): string {
  const lines = [
    'Sales response to Verification',
    `Request: ${input.requestId}`,
    `Requirement: ${input.requirementTitle}`,
    `Submitted by: ${input.userName}`,
    '',
    ...Object.entries(input.values).map(
      ([key, value]) => `${input.labels.get(key) ?? key}: ${value}`,
    ),
  ];
  if (input.note) lines.push('', `Note: ${input.note}`);
  return lines.join('\n');
}

export async function verificationPipelineRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/verification/clients', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    const cacheKey = [
      'verification',
      ctx.tenantId,
      ownerId,
      q.state,
      q.page,
      q.page_size,
      q.q?.toLowerCase() ?? '',
    ].join(':');
    const forceRefresh = ctx.allDepartmentAccess && request.headers['x-cache-refresh'] === '1';
    const cached = await verificationPageCache.getOrLoad(
      cacheKey,
      async () => {
        let matched;
        let truncated;
        try {
          const opts = q.q ? { search: q.q } : {};
          const listed = await listAgentVerificationDeals(ownerId, opts);
          matched = listed.clients;
          truncated = listed.truncated;
        } catch (err) {
          throw crmError(err);
        }
        const dealIds = matched
          .map((client) => client.dealId)
          .filter((id): id is string => Boolean(id));
        const [summaryResult, responseResult] = await Promise.allSettled([
          getLiveVerificationSummaries(dealIds),
          verificationSalesResponseRepo.listForRequests(ctx, dealIds),
        ]);
        if (summaryResult.status === 'rejected') {
          request.log.warn({ err: summaryResult.reason }, 'verification card summary unavailable');
        }
        if (responseResult.status === 'rejected') {
          request.log.warn(
            { err: responseResult.reason },
            'verification response history unavailable',
          );
        }
        const summaries =
          summaryResult.status === 'fulfilled'
            ? summaryResult.value
            : new Map<string, VerificationCardSummary>();
        const responses = responseResult.status === 'fulfilled' ? responseResult.value : [];
        const responded = new Set(
          responses.map((row) => `${row.requestId}:${row.externalEventId}`),
        );
        const sourceHealth = {
          crm: 'ok' as const,
          verification:
            summaryResult.status === 'fulfilled' ? ('ok' as const) : ('degraded' as const),
          responses:
            responseResult.status === 'fulfilled' ? ('ok' as const) : ('degraded' as const),
        };
        let enriched = matched.map((client) => {
          const summary = client.dealId ? summaries.get(client.dealId) : undefined;
          return {
            ...client,
            attentionCount:
              summary?.requirementEventIds.filter(
                (eventId) => !responded.has(`${client.dealId}:${eventId}`),
              ).length ?? 0,
            verificationStatus: summary?.status ?? null,
            verificationUpdatedAt: summary?.updatedAt ?? null,
            verificationState: summary?.state ?? deriveZohoState(client),
            plaidLinkUrl: summary?.plaidLinkUrl ?? null,
            plaidStatus: summary?.plaidStatus ?? null,
            cpLimit: summary?.approvedLimit ?? null,
            cpPaymentType: summary?.paymentType ?? null,
            cpBillingCycle: summary?.billingCycle ?? null,
            missingFields: summary?.missingFields ?? [],
            docsUploaded: summary?.docsUploaded ?? 0,
            workingOn: summary?.workingOn ?? null,
          };
        });
        if (q.state !== 'all') {
          enriched = enriched.filter((client) =>
            q.state === 'in_progress'
              ? client.verificationState === 'in_progress' || client.verificationState === 'queued'
              : client.verificationState === q.state,
          );
        }
        const total = enriched.length;
        const offset = (q.page - 1) * q.page_size;
        return {
          clients: enriched.slice(offset, offset + q.page_size),
          pagination: {
            page: q.page,
            pageSize: q.page_size,
            total,
            pageCount: Math.max(1, Math.ceil(total / q.page_size)),
            /** The owner's history exceeded the COQL drain cap, so `total` is a floor. */
            truncated,
          },
          sourceHealth,
          partial: sourceHealth.verification !== 'ok' || sourceHealth.responses !== 'ok',
        };
      },
      { ttlMs: 90_000, staleIfErrorMs: 10 * 60_000, force: forceRefresh },
    );
    return {
      ...cached.data,
      freshness: cached.freshness,
      generatedAt: cached.generatedAt,
      ...(cached.staleReason ? { staleReason: cached.staleReason } : {}),
    };
  });

  app.get('/verification/pipeline', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = pipelineQuery.parse(request.query);
    let snapshot;
    try {
      snapshot = await getPipelineProvider().getPipeline({
        dealId: q.dealId ?? null,
        carrierId: q.carrierId ?? null,
        applicationId: q.applicationId ?? null,
        dot: q.dot ?? null,
      });
    } catch (err) {
      throw new AppError('Verification platform request failed', {
        statusCode: 502,
        code: 'VERIFICATION_PLATFORM_ERROR',
        cause: err,
        expose: true,
      });
    }
    if (snapshot?.requestId && snapshot.requirements.length) {
      try {
        const responses = await verificationSalesResponseRepo.listForRequest(
          ctx,
          snapshot.requestId,
        );
        const byEvent = new Map(responses.map((row) => [row.externalEventId, responseDto(row)]));
        snapshot = {
          ...snapshot,
          requirements: snapshot.requirements.map((requirement) => ({
            ...requirement,
            ...(byEvent.get(requirement.eventId)
              ? { response: byEvent.get(requirement.eventId) }
              : {}),
          })),
        };
      } catch (err) {
        request.log.warn({ err }, 'verification response history unavailable for pipeline');
      }
    }
    return { snapshot };
  });

  /**
   * Answer one payload-driven Verification requirement. credit_platform is read-only, so the
   * response is sent through the source-of-truth Zoho Deal: known MC/DOT fields are updated and an
   * auditable Note (plus optional attachment) is created. The local tenant-scoped row is the
   * idempotency/history record.
   */
  app.post('/verification/responses', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const ownerId = resolveZohoUserId(ctx);
    const upload = await readResponseUpload(request);
    const body = responseFields.parse(upload.fields);
    let values: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(body.values);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('not an object');
      values = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value ?? '').trim(),
        ]),
      );
    } catch {
      throw new AppError('Response values must be a JSON object.', {
        statusCode: 400,
        code: 'INVALID_RESPONSE_VALUES',
        expose: true,
      });
    }

    const existing = await verificationSalesResponseRepo.findByEvent(
      ctx,
      body.requestId,
      body.externalEventId,
    );
    if (existing) return { response: responseDto(existing), duplicate: true };

    const dealOwnerId = await fetchDealOwnerId(body.dealId).catch(() => null);
    if (!dealOwnerId || (!ctx.allDepartmentAccess && dealOwnerId !== ownerId)) {
      throw new AppError('This verification request is not assigned to you.', {
        statusCode: 403,
        code: 'VERIFICATION_DEAL_FORBIDDEN',
        expose: true,
      });
    }

    const snapshot = await getPipelineProvider().getPipeline({ dealId: body.dealId });
    if (!snapshot || snapshot.requestId !== body.requestId) {
      throw new AppError('Verification request was not found for this deal.', {
        statusCode: 404,
        code: 'VERIFICATION_REQUEST_NOT_FOUND',
        expose: true,
      });
    }
    const requirement = snapshot.requirements.find((item) => item.eventId === body.externalEventId);
    if (!requirement) {
      throw new AppError('Verification action request no longer exists.', {
        statusCode: 409,
        code: 'VERIFICATION_REQUIREMENT_MISSING',
        expose: true,
      });
    }
    const allowed = new Set(requirement.fields.map((field) => field.id));
    values = Object.fromEntries(Object.entries(values).filter(([key]) => allowed.has(key)));
    const missing = requirement.fields.filter(
      (field) => field.required && !values[field.id]?.trim(),
    );
    if (missing.length) {
      throw new AppError(
        `Required response missing: ${missing.map((field) => field.label).join(', ')}`,
        {
          statusCode: 400,
          code: 'VERIFICATION_RESPONSE_INCOMPLETE',
          expose: true,
        },
      );
    }
    if (requirement.attachmentRequired && !upload.file) {
      throw new AppError('Verification requires an attachment for this response.', {
        statusCode: 400,
        code: 'VERIFICATION_ATTACHMENT_REQUIRED',
        expose: true,
      });
    }

    const updates = crmKnownFields(values);
    const actorId = zohoActorId(ctx);
    if (Object.keys(updates).length) {
      await updateRecordAsUser(ctx.tenantId, actorId, 'Deals', body.dealId, updates);
    }
    const labels = new Map(requirement.fields.map((field) => [field.id, field.label]));
    const noteId = await createRecordNote(
      'Deals',
      body.dealId,
      {
        title: `Verification response · ${requirement.title}`.slice(0, 120),
        content: noteContent({
          requestId: body.requestId,
          requirementTitle: requirement.title,
          userName: ctx.userName || ownerId,
          values,
          labels,
          note: body.note?.trim() ?? '',
        }),
      },
      ctx,
    );
    let syncWarning: string | null = null;
    if (upload.file) {
      try {
        await attachFileAsUser(
          ctx.tenantId,
          actorId,
          'Notes',
          noteId,
          upload.file.name,
          upload.file.buffer,
          upload.file.mime,
        );
      } catch (err) {
        request.log.warn({ err, noteId }, 'verification response attachment upload failed');
        syncWarning = 'The response was sent, but the attachment could not be added to Zoho.';
      }
    }
    const saved = await verificationSalesResponseRepo.create(ctx, {
      requestId: body.requestId,
      dealId: body.dealId,
      externalEventId: body.externalEventId,
      ownerZohoUserId: ownerId,
      responseValues: values,
      note: body.note?.trim() || null,
      attachmentName: upload.file?.name ?? null,
      attachmentContentType: upload.file?.mime ?? null,
      attachmentSizeBytes: upload.file?.buffer.length ?? null,
      zohoNoteId: noteId,
      syncWarning,
    });
    await auditFromContext(ctx, {
      action: 'sales.verification.response_sent',
      status: 'ok',
      resourceType: 'verification_request',
      resourceId: body.requestId,
      detail: {
        dealId: body.dealId,
        externalEventId: body.externalEventId,
        fields: Object.keys(values),
        hasAttachment: Boolean(upload.file),
        noteId,
      },
    });
    verificationPageCache.invalidate(`verification:${ctx.tenantId}:`);
    return { response: responseDto(saved), duplicate: false };
  });
}
