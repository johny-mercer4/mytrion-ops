/**
 * Human-watched Decision Desk queue actions (claim / release / Plaid / parse / iSoftPull).
 * HTTP only — never inbox run_stage. Transfer is stubbed: CP deleted /transfer.
 */
import { AppError } from '../../lib/errors.js';
import {
  claimManualReview,
  parseBankStatements,
  releaseManualReview,
  runIsoftpullAll,
} from '../../integrations/creditPlatformClient.js';
import { insertPlaidLinkAction, isWriteConfigured } from '../../integrations/creditPlatformWriteDb.js';
import { stampMytrionAgent } from '../../integrations/creditPlatformInboxWrites.js';
import { auditFromContext } from '../audit/auditLogger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { verificationCaseRepo } from '../../repos/verificationCaseRepo.js';
import { buildCasesCsv, creditPlatformActor } from './verificationCaseDesk.js';
import { getVerificationCase, type VerificationCaseDetail } from './verificationCases.js';
import { listRequestAttachments } from './verificationCaseExtras.js';

const TRANSFER_COPY =
  'Transfer is not on credit-platform HTTP yet. Hand the case off from Decision Desk until that route is restored.';

function requireBoundRequest(requestId: string | null): string {
  if (!requestId) {
    throw new AppError('This case is not bound to a credit-platform request yet.', {
      statusCode: 409,
      code: 'VERIFICATION_REQUEST_UNBOUND',
      expose: true,
    });
  }
  return requestId;
}

async function afterCpWrite(
  ctx: TenantContext,
  id: string,
  requestId: string,
  action: string,
  detail: Record<string, unknown>,
  ok: boolean,
  error?: string,
): Promise<VerificationCaseDetail> {
  await auditFromContext(ctx, {
    action,
    status: ok ? 'ok' : 'error',
    resourceType: 'verification_case',
    resourceId: id,
    detail: { requestId, ...detail, ...(error ? { error } : {}) },
  });
  if (!ok) {
    throw new AppError(error || 'Credit-platform action failed.', {
      statusCode: 502,
      code: 'CREDIT_PLATFORM_ACTION_FAILED',
      expose: true,
    });
  }
  return getVerificationCase(ctx, id, { sync: true });
}

export async function claimVerificationCase(
  ctx: TenantContext,
  id: string,
  note?: string,
): Promise<VerificationCaseDetail> {
  const row = await getVerificationCase(ctx, id, { sync: false });
  const requestId = requireBoundRequest(row.case.requestId);
  const actor = creditPlatformActor(ctx);
  const done = await claimManualReview(requestId, actor, note);
  return afterCpWrite(ctx, id, requestId, 'verification.case.claim', { actor }, done.ok, done.error);
}

export async function releaseVerificationCase(
  ctx: TenantContext,
  id: string,
  note?: string,
): Promise<VerificationCaseDetail> {
  const row = await getVerificationCase(ctx, id, { sync: false });
  const requestId = requireBoundRequest(row.case.requestId);
  const actor = creditPlatformActor(ctx);
  const done = await releaseManualReview(requestId, actor, note);
  return afterCpWrite(ctx, id, requestId, 'verification.case.release', { actor }, done.ok, done.error);
}

export function transferVerificationCaseUnavailable(): never {
  throw new AppError(TRANSFER_COPY, {
    statusCode: 501,
    code: 'TRANSFER_UNAVAILABLE',
    expose: true,
  });
}

export async function generateVerificationPlaidLink(
  ctx: TenantContext,
  id: string,
  regenerate = false,
): Promise<{ status: string; inboxId: number }> {
  if (!isWriteConfigured()) {
    throw new AppError('The verification write-back path is not enabled.', {
      statusCode: 503,
      code: 'VERIFICATION_WRITE_DISABLED',
      expose: true,
    });
  }
  const row = await getVerificationCase(ctx, id, { sync: false });
  const requestId = requireBoundRequest(row.case.requestId);
  const agent = stampMytrionAgent(ctx.userName || ctx.userId || 'system');
  const { id: inboxId } = await insertPlaidLinkAction({ requestId, agent, regenerate });
  await auditFromContext(ctx, {
    action: 'verification.case.plaid_link_queued',
    status: 'ok',
    resourceType: 'verification_case',
    resourceId: id,
    detail: { requestId, inboxId, regenerate },
  });
  return { status: 'queued', inboxId };
}

export async function parseVerificationBankStatements(
  ctx: TenantContext,
  id: string,
  attachmentIds?: number[],
): Promise<VerificationCaseDetail> {
  const row = await getVerificationCase(ctx, id, { sync: false });
  const requestId = requireBoundRequest(row.case.requestId);
  let ids = attachmentIds?.filter((n) => Number.isInteger(n) && n > 0) ?? [];
  if (!ids.length) {
    const files = await listRequestAttachments(requestId);
    ids = files
      .filter((file) => file.scope === 'sales_bank_statement')
      .map((file) => Number(file.id))
      .filter((n) => Number.isInteger(n) && n > 0);
  }
  if (!ids.length) {
    throw new AppError('Upload a bank statement before parse.', {
      statusCode: 400,
      code: 'NO_BANK_STATEMENTS',
      expose: true,
    });
  }
  const actor = creditPlatformActor(ctx);
  const done = await parseBankStatements(requestId, ids, actor);
  return afterCpWrite(ctx, id, requestId, 'verification.case.bank_statement_parse', { attachmentIds: ids }, done.ok, done.error);
}

export async function runVerificationIsoftpullAll(
  ctx: TenantContext,
  id: string,
): Promise<VerificationCaseDetail> {
  const row = await getVerificationCase(ctx, id, { sync: false });
  const requestId = requireBoundRequest(row.case.requestId);
  const actor = creditPlatformActor(ctx);
  const done = await runIsoftpullAll(requestId, actor);
  return afterCpWrite(ctx, id, requestId, 'verification.case.isoftpull_run_all', { actor }, done.ok, done.error);
}

export async function exportVerificationCases(
  ctx: TenantContext,
  filter: Parameters<typeof verificationCaseRepo.list>[1],
): Promise<{ filename: string; csv: string }> {
  const items = await verificationCaseRepo.list(ctx, { ...filter, limit: 2000, offset: 0 });
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `verification-cases-${stamp}.csv`, csv: buildCasesCsv(items) };
}
