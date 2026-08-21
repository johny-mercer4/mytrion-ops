/**
 * Spend authorisation — the typed hook for metered vendors.
 *
 * POLICY: any verification-capable caller may be granted; every grant is attributed and audited.
 * Phase 10 "recorded not blocked" shape — we do not invent a per-case or per-day spend ceiling.
 *
 * The attempt ledger is persisted (`vendorSpendLedgerRepo`). The WeakSet is only the forge-proof
 * token: a grant for vendor A must not authorise vendor B, and a forged object is not issued.
 * Inserting the ledger row is fail-close — if it throws, `runVendor` must not call the vendor.
 */
import { createId } from '@paralleldrive/cuid2';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { vendorSpendLedgerRepo } from '../../repos/vendorSpendLedgerRepo.js';
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

export async function recordAttempt(input: {
  ctx: TenantContext;
  vendorId: string;
  caseId: string;
}): Promise<SpendAttempt> {
  const row: SpendAttempt = {
    id: createId(),
    vendorId: input.vendorId,
    caseId: input.caseId,
    status: 'pending',
  };
  // Persist first. A throw here must reach runVendor before `call`.
  await vendorSpendLedgerRepo.insertAttempt({
    id: row.id,
    tenantId: input.ctx.tenantId,
    vendorId: input.vendorId,
    caseId: input.caseId,
    requestedBy: input.ctx.userId,
  });
  attempts.push(row);
  return row;
}

export async function resolveAttempt(id: string, status: 'ok' | 'error'): Promise<void> {
  const row = attempts.find((attempt) => attempt.id === id);
  if (row) row.status = status;
  try {
    await vendorSpendLedgerRepo.resolveAttempt(id, status);
  } catch {
    // The vendor HTTP already happened — do not retry it. The pending row stays for ops.
  }
}

/** Test hook. Production readers should query the table. */
export function listSpendAttempts(): readonly SpendAttempt[] {
  return attempts;
}

export function resetSpendAttempts(): void {
  attempts.length = 0;
}
