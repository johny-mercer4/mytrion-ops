/**
 * Spend authorisation — the typed hook for *future* metered vendors.
 *
 * POLICY (pending a business confirm): any verification-capable caller may be granted;
 * every grant is attributed and audited. Phase 10 "recorded not blocked" shape — we do
 * not invent a per-case or per-day spend ceiling here.
 *
 * The attempt ledger is in-memory and testable. A table + `repos/` lands before the first
 * live metered pull. This file must not grow a ceiling in the meantime.
 */
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import type { TenantContext } from '../../types/tenantContext.js';

declare const spendAuthorisationBrand: unique symbol;

/**
 * Opaque token. Callers cannot construct a literal that satisfies this — the brand is
 * unique and unexported. The only mint is {@link authoriseSpend}.
 */
export type SpendAuthorisation = {
  readonly [spendAuthorisationBrand]: true;
  readonly vendorId: string;
  readonly caseId: string;
};

const issued = new WeakSet<object>();

export function isIssuedSpend(value: unknown): value is SpendAuthorisation {
  return typeof value === 'object' && value !== null && issued.has(value);
}

function isVerificationCapable(ctx: TenantContext): boolean {
  if (ctx.audience !== 'internal') return false;
  return (
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes('verification')
  );
}

export async function authoriseSpend(input: {
  ctx: TenantContext;
  caseId: string;
  vendorId: string;
  reason: string;
}): Promise<SpendAuthorisation | null> {
  const capable = isVerificationCapable(input.ctx);
  await auditFromContext(input.ctx, {
    action: 'verification.vendor.spend',
    status: capable ? 'ok' : 'denied',
    resourceType: 'verification_vendor',
    resourceId: input.vendorId,
    detail: { caseId: input.caseId, reason: input.reason, granted: capable },
  });
  if (!capable) return null;
  // Brand mint — the unique symbol is type-only; WeakSet is the runtime belt.
  const token = { vendorId: input.vendorId, caseId: input.caseId } as SpendAuthorisation;
  issued.add(token);
  return token;
}

export type SpendAttemptStatus = 'pending' | 'ok' | 'error';

export interface SpendAttempt {
  id: string;
  vendorId: string;
  caseId: string;
  status: SpendAttemptStatus;
}

const attempts: SpendAttempt[] = [];
let nextAttemptId = 0;

export function recordAttempt(input: { vendorId: string; caseId: string }): SpendAttempt {
  nextAttemptId += 1;
  const row: SpendAttempt = {
    id: `attempt-${nextAttemptId}`,
    vendorId: input.vendorId,
    caseId: input.caseId,
    status: 'pending',
  };
  attempts.push(row);
  return row;
}

export function resolveAttempt(id: string, status: 'ok' | 'error'): void {
  const row = attempts.find((attempt) => attempt.id === id);
  if (row) row.status = status;
}

/** Test hook. The in-memory ledger is replaced by a table before any live metered pull. */
export function listSpendAttempts(): readonly SpendAttempt[] {
  return attempts;
}

export function resetSpendAttempts(): void {
  attempts.length = 0;
  nextAttemptId = 0;
}
