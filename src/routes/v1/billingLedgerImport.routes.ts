/**
 * Billing Ledger — Excel template, export, and the bulk opening-balance import
 * (/v1/billing/ledger/opening-balances/{template,export,import/*}).
 *
 * Split from ./billingLedger.routes.ts so the multipart and workbook concerns stay together and
 * neither file approaches the 600-line cap.
 *
 * THE FLOW: upload → validate (writes NOTHING, stores the verdicts, status `pending`) → the agent
 * reviews → commit (applies exactly the previewed rows in ONE transaction) or discard. A committed
 * batch can be reverted wholesale.
 *
 * The preview and commit responses carry per-row verdicts in a 200/201 BODY rather than a 4xx. A
 * partially-valid spreadsheet is a *successful* preview — rejected rows are data, not a protocol
 * error. This is the one deliberate exception to this surface's thrown-AppError convention.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  buildOpeningExport,
  buildOpeningTemplate,
  buildRejectedRowsWorkbook,
} from '../../modules/billing/ledger/excelTemplate.js';
import { MAX_IMPORT_ROWS, validateWorkbook } from '../../modules/billing/ledger/import.js';
import { requireLedgerSchema } from '../../modules/billing/ledger/readiness.js';
import { LEDGER_SECTION_IDS } from '../../modules/billing/ledger/sections.js';
import { ledgerImportBatchRepo } from '../../repos/ledgerImportBatchRepo.js';
import { ledgerOpeningBalanceRepo } from '../../repos/ledgerOpeningBalanceRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireLedgerRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'billing', 'Billing Ledger');
}
function requireLedgerWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'billing', 'Billing Ledger');
}
function actor(ctx: TenantContext): string {
  return ctx.userName ?? 'A billing agent';
}

/**
 * 10 MB — exactly the global multipart floor registered in src/app.ts, so a route cap can never
 * exceed the parser ceiling (which would kill the request before this route's clearer 413 could run).
 */
const LEDGER_IMPORT_MAX_BYTES = 10_000_000;

/** How long a stored preview stays committable. Beyond this the live values may have moved. */
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

const sectionEnum = z.enum(LEDGER_SECTION_IDS);

const templateQuery = z.object({
  section: sectionEnum,
  includeCarriers: z.enum(['all', 'missing', 'with-value']).default('missing'),
});
const exportQuery = z.object({ section: sectionEnum.optional() });
const batchIdParam = z.object({ batchId: z.string().min(1).max(60) });
const batchRowsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
  verdict: z.enum(['accept', 'reject', 'unchanged']).optional(),
  changeKind: z.enum(['new', 'changed', 'unchanged']).optional(),
});
const commitBody = z
  .object({
    /**
     * Overwriting an existing balance is always a conscious act — a batch with `changed > 0` refuses
     * until the agent says so explicitly.
     */
    acknowledgeChanged: z.boolean().default(false),
  })
  .default({ acknowledgeChanged: false });

export async function billingLedgerImportRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey], preHandler: [requireLedgerSchema] };

  // ─── Excel downloads ───────────────────────────────────────────────────────────────────────

  /**
   * The fill-in template. Audited: it enumerates the carrier book, which is worth a record.
   * Default audience is `missing` — the carriers still owed a balance, i.e. the actual work queue.
   */
  app.get('/billing/ledger/opening-balances/template', guard, async (request, reply) => {
    const ctx = requireLedgerRead(request);
    const q = templateQuery.parse(request.query);
    const wb = await buildOpeningTemplate({ section: q.section, includeCarriers: q.includeCarriers });
    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.template',
      status: 'ok',
      resourceType: 'ledger_opening_balance',
      resourceId: q.section,
      detail: { section: q.section, includeCarriers: q.includeCarriers, rows: wb.rowCount },
    });
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Type', wb.contentType)
      .header('Content-Length', wb.bytes.length)
      .header('Content-Disposition', `attachment; filename="${wb.fileName}"`)
      .send(wb.bytes);
  });

  /** Export the balances already saved. */
  app.get('/billing/ledger/opening-balances/export', guard, async (request, reply) => {
    const ctx = requireLedgerRead(request);
    const q = exportQuery.parse(request.query);
    const wb = await buildOpeningExport({ section: q.section });
    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.export',
      status: 'ok',
      resourceType: 'ledger_opening_balance',
      resourceId: q.section ?? 'all',
      detail: { section: q.section ?? null, rows: wb.rowCount },
    });
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Type', wb.contentType)
      .header('Content-Length', wb.bytes.length)
      .header('Content-Disposition', `attachment; filename="${wb.fileName}"`)
      .send(wb.bytes);
  });

  // ─── Import ────────────────────────────────────────────────────────────────────────────────

  /**
   * Upload + validate. Writes no balances — only the batch record with its per-row verdicts.
   *
   * Follows the csMaintenance attachment route's multipart shape, with one deliberate difference:
   * NO `requireStorageConfigured` and NO `getStorage().put`. The bytes are parsed and discarded; only
   * the parsed verdicts persist, so S3 is not in the path and the route works where storage is unset.
   */
  app.post('/billing/ledger/opening-balances/import/preview', guard, async (request, reply) => {
    const ctx = requireLedgerWrite(request);

    const part = await request.file({ limits: { fileSize: LEDGER_IMPORT_MAX_BYTES } });
    if (!part) throw new ValidationError('Expected a multipart file field named "file".');

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (e) {
      // @fastify/multipart raises this once the per-file cap is passed.
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(
          `That file is larger than ${Math.round(LEDGER_IMPORT_MAX_BYTES / 1_000_000)} MB.`,
          { statusCode: 413, code: 'LEDGER_IMPORT_TOO_LARGE', expose: true },
        );
      }
      throw e;
    }
    if (!buffer.length) throw new ValidationError('That file is empty.', { code: 'EMPTY_FILE' });

    const result = await validateWorkbook(buffer);

    // Identical bytes with a batch still pending → resume it instead of forking a second preview.
    const existing = await ledgerImportBatchRepo.findPendingBySha(result.sha256);
    if (existing) {
      return reply.code(200).send({
        batchId: existing.id,
        resumed: true,
        fileName: existing.fileName,
        templateVersion: existing.templateVersion,
        summary: {
          rowCount: existing.rowCount,
          accepted: existing.acceptedCount,
          rejected: existing.rejectedCount,
          changed: existing.changedCount,
          new: existing.newCount,
          unchanged: existing.unchangedCount,
        },
        fileErrors: existing.fileErrors ?? [],
        expiresAt: existing.expiresAt?.toISOString() ?? null,
      });
    }

    const batch = await ledgerImportBatchRepo.create({
      fileName: part.filename || 'upload.xlsx',
      fileBytes: buffer.length,
      fileSha256: result.sha256,
      templateVersion: result.templateVersion,
      summary: result.summary,
      rows: result.rows,
      fileErrors: result.fileErrors,
      uploadedByUserId: ctx.userId,
      uploadedByName: actor(ctx),
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    });

    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.import_preview',
      status: 'ok',
      resourceType: 'ledger_import_batch',
      resourceId: batch.id,
      detail: { fileName: batch.fileName, bytes: buffer.length, ...result.summary },
    });

    return reply.code(201).send({
      batchId: batch.id,
      resumed: false,
      fileName: batch.fileName,
      templateVersion: result.templateVersion,
      summary: result.summary,
      fileErrors: result.fileErrors,
      expiresAt: batch.expiresAt?.toISOString() ?? null,
      maxRows: MAX_IMPORT_ROWS,
    });
  });

  /** Page the stored verdicts. Never returns the whole blob. */
  app.get('/billing/ledger/opening-balances/import/:batchId', guard, async (request) => {
    requireLedgerRead(request);
    const { batchId } = batchIdParam.parse(request.params);
    const q = batchRowsQuery.parse(request.query);
    const batch = await ledgerImportBatchRepo.findById(batchId);
    if (!batch) throw new NotFoundError(`Import batch ${batchId} not found`);

    const { rows, total } = await ledgerImportBatchRepo.listRows(batchId, {
      limit: q.limit,
      offset: (q.page - 1) * q.limit,
      verdict: q.verdict,
      changeKind: q.changeKind,
    });

    return {
      batchId: batch.id,
      status: batch.status,
      fileName: batch.fileName,
      templateVersion: batch.templateVersion,
      summary: {
        rowCount: batch.rowCount,
        accepted: batch.acceptedCount,
        rejected: batch.rejectedCount,
        changed: batch.changedCount,
        new: batch.newCount,
        unchanged: batch.unchangedCount,
      },
      fileErrors: batch.fileErrors ?? [],
      /** null once the sweep has dropped the detail — the counts above survive. */
      detailAvailable: batch.validation !== null,
      rows,
      total,
      page: q.page,
      limit: q.limit,
      hasMore: q.page * q.limit < total,
      expiresAt: batch.expiresAt?.toISOString() ?? null,
      uploadedByName: batch.uploadedByName,
      uploadedAt: batch.uploadedAt.toISOString(),
      committedAt: batch.committedAt?.toISOString() ?? null,
      revertedAt: batch.revertedAt?.toISOString() ?? null,
    };
  });

  /**
   * Apply the previewed rows. Refuses rather than guessing when:
   *   • the batch is not `pending` (already committed / discarded / reverted),
   *   • the preview expired — the live values may have moved since,
   *   • `changed > 0` without an explicit acknowledgement,
   *   • any accepted row's live value moved since the preview (drift) — that would silently overwrite
   *     someone else's correction, which for an opening balance restates every downstream day.
   */
  app.post('/billing/ledger/opening-balances/import/:batchId/commit', guard, async (request) => {
    const ctx = requireLedgerWrite(request);
    const { batchId } = batchIdParam.parse(request.params);
    const b = commitBody.parse(request.body ?? {});

    const batch = await ledgerImportBatchRepo.findById(batchId);
    if (!batch) throw new NotFoundError(`Import batch ${batchId} not found`);

    const fail = async (message: string, code: string, details?: unknown): Promise<never> => {
      await auditFromContext(ctx, {
        action: 'billing.ledger.opening_balance.import_commit',
        status: 'error',
        resourceType: 'ledger_import_batch',
        resourceId: batchId,
        detail: { code, message },
      });
      throw new ConflictError(message, { code, details });
    };

    if (batch.status !== 'pending') {
      await fail(`This batch is already ${batch.status}.`, 'LEDGER_IMPORT_NOT_PENDING');
    }
    if (batch.expiresAt && batch.expiresAt.getTime() < Date.now()) {
      await fail(
        'This preview expired — re-upload the file so the changes are checked against current values.',
        'PREVIEW_EXPIRED',
      );
    }
    if (batch.changedCount > 0 && !b.acknowledgeChanged) {
      await fail(
        `${batch.changedCount} row${batch.changedCount === 1 ? '' : 's'} would overwrite an existing opening balance — confirm to continue.`,
        'LEDGER_IMPORT_NEEDS_ACK',
        { changed: batch.changedCount },
      );
    }

    const accepted = await ledgerImportBatchRepo.acceptedRows(batchId);
    if (!accepted.length) {
      await fail('This batch has no rows to apply.', 'LEDGER_IMPORT_EMPTY');
    }

    // Drift check: compare each accepted row's previewed predecessor against the CURRENT live row.
    const live = await ledgerOpeningBalanceRepo.findLiveBatch(accepted.map((r) => r.carrierId));
    const drifted = accepted.filter((r) => {
      const current = live.get(`${r.carrierId}:${r.section}`)?.id ?? null;
      return current !== r.previousRevisionId;
    });
    if (drifted.length) {
      await fail(
        `${drifted.length} carrier${drifted.length === 1 ? '' : 's'} changed since this preview — re-upload to see the current values.`,
        'LEDGER_IMPORT_DRIFTED',
        { carriers: drifted.slice(0, 25).map((r) => ({ carrierId: r.carrierId, section: r.section })) },
      );
    }

    const { committed } = await ledgerOpeningBalanceRepo.commitBatch(
      accepted.map((r) => ({
        carrierId: r.carrierId,
        section: r.section,
        asOfDate: r.asOfDate,
        amount: r.amount ?? 0,
        source: 'excel' as const,
        note: r.note,
        createdByUserId: ctx.userId,
        createdByName: actor(ctx),
      })),
      batchId,
    );
    await ledgerImportBatchRepo.setStatus(batchId, 'committed', { name: actor(ctx) });

    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.import_commit',
      status: 'ok',
      resourceType: 'ledger_import_batch',
      resourceId: batchId,
      detail: {
        fileName: batch.fileName,
        committed,
        skipped: batch.rejectedCount + batch.unchangedCount,
        changed: batch.changedCount,
        new: batch.newCount,
      },
    });

    return {
      batchId,
      committed,
      skipped: batch.rejectedCount + batch.unchangedCount,
      rejected: batch.rejectedCount,
      unchanged: batch.unchangedCount,
    };
  });

  /** Throw the preview away. */
  app.post('/billing/ledger/opening-balances/import/:batchId/discard', guard, async (request) => {
    const ctx = requireLedgerWrite(request);
    const { batchId } = batchIdParam.parse(request.params);
    const batch = await ledgerImportBatchRepo.findById(batchId);
    if (!batch) throw new NotFoundError(`Import batch ${batchId} not found`);
    if (batch.status !== 'pending') {
      throw new ConflictError(`This batch is already ${batch.status}.`, {
        code: 'LEDGER_IMPORT_NOT_PENDING',
      });
    }
    await ledgerImportBatchRepo.setStatus(batchId, 'discarded', { name: actor(ctx) });
    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.import_discard',
      status: 'ok',
      resourceType: 'ledger_import_batch',
      resourceId: batchId,
      detail: { fileName: batch.fileName },
    });
    return { batchId, status: 'discarded' };
  });

  /**
   * Undo a committed batch. Every revision the batch created is superseded and its predecessor's
   * values are written back as NEW revisions — the append-only chain is the revert journal, so no
   * separate bulk_change_log analogue is needed. Where the batch created a carrier's FIRST balance,
   * the row is superseded with no successor: reverting means having none again, not having zero.
   */
  app.post('/billing/ledger/opening-balances/import/:batchId/revert', guard, async (request) => {
    const ctx = requireLedgerWrite(request);
    const { batchId } = batchIdParam.parse(request.params);
    const batch = await ledgerImportBatchRepo.findById(batchId);
    if (!batch) throw new NotFoundError(`Import batch ${batchId} not found`);
    if (batch.status !== 'committed') {
      throw new ConflictError(`Only a committed batch can be reverted; this one is ${batch.status}.`, {
        code: 'LEDGER_IMPORT_NOT_COMMITTED',
      });
    }

    const { reverted, cleared } = await ledgerOpeningBalanceRepo.revertBatch(batchId, {
      userId: ctx.userId,
      name: actor(ctx),
    });

    /**
     * Nothing was still live from this batch — every value it wrote has since been superseded by a
     * later import or a manual edit. Refuse rather than report a no-op as a successful revert: an
     * agent who is told "reverted" will believe the old numbers are back. Undoing this batch now would
     * also mean clobbering someone's newer correction, which is not what "revert this batch" asks for.
     */
    if (reverted === 0 && cleared === 0) {
      await auditFromContext(ctx, {
        action: 'billing.ledger.opening_balance.import_revert',
        status: 'error',
        resourceType: 'ledger_import_batch',
        resourceId: batchId,
        detail: { code: 'LEDGER_IMPORT_SUPERSEDED', fileName: batch.fileName },
      });
      throw new ConflictError(
        'Nothing from this batch is still current — later changes have replaced every value it wrote. Restore the individual revisions you want from each carrier’s history.',
        { code: 'LEDGER_IMPORT_SUPERSEDED' },
      );
    }

    await ledgerImportBatchRepo.setStatus(batchId, 'reverted', { name: actor(ctx) });

    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.import_revert',
      status: 'ok',
      resourceType: 'ledger_import_batch',
      resourceId: batchId,
      detail: { fileName: batch.fileName, restored: reverted, cleared },
    });
    return { batchId, restored: reverted, cleared };
  });

  /** The rejected rows as an annotated workbook — how a 400-row file actually gets fixed. */
  app.get('/billing/ledger/opening-balances/import/:batchId/rejected.xlsx', guard, async (request, reply) => {
    requireLedgerRead(request);
    const { batchId } = batchIdParam.parse(request.params);
    const batch = await ledgerImportBatchRepo.findById(batchId);
    if (!batch) throw new NotFoundError(`Import batch ${batchId} not found`);
    if (batch.validation === null) {
      throw new NotFoundError('The row detail for this batch has been swept; only the counts remain.');
    }
    const rejected = (batch.validation ?? []).filter((r) => r.verdict === 'reject');
    const wb = await buildRejectedRowsWorkbook(rejected);
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Type', wb.contentType)
      .header('Content-Length', wb.bytes.length)
      .header('Content-Disposition', `attachment; filename="${wb.fileName}"`)
      .send(wb.bytes);
  });

  /** Recent batches — the import history strip. */
  app.get('/billing/ledger/opening-balances/imports', guard, async (request) => {
    requireLedgerRead(request);
    const batches = await ledgerImportBatchRepo.listRecent(25);
    return {
      batches: batches.map((b) => ({
        batchId: b.id,
        status: b.status,
        fileName: b.fileName,
        rowCount: b.rowCount,
        accepted: b.acceptedCount,
        rejected: b.rejectedCount,
        changed: b.changedCount,
        uploadedByName: b.uploadedByName,
        uploadedAt: b.uploadedAt.toISOString(),
        committedAt: b.committedAt?.toISOString() ?? null,
        revertedAt: b.revertedAt?.toISOString() ?? null,
      })),
    };
  });
}
