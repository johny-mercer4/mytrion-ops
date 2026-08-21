/**
 * Vendor dispatcher. NEVER THROWS — bad args, a thrown `configured()`, a thrown `call`,
 * or a thrown URL/arg builder all become `available: false`.
 *
 * NO RETRIES, including for free vendors. Metered calls must never be retried (a second
 * pull is a second charge). Free vendors also get no retry in this step — do not add one
 * here; Socrata/FMCSA already document why a retry loop is the wrong throttle.
 *
 * Timeout is `fetchWithTimeout` / `env.OUTBOUND_HTTP_TIMEOUT_MS` inside the vendor `call`.
 * This dispatcher does not wrap a second deadline.
 */
import { errorMessage } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  isIssuedSpend,
  recordAttempt,
  resolveAttempt,
  type SpendAuthorisation,
} from './spend.js';
import type {
  FreeVendorDescriptor,
  MeteredVendorDescriptor,
  VendorDescriptor,
  VendorResult,
  VendorUnavailableReason,
} from './types.js';

export interface RunVendorInput<TArgs> {
  ctx: TenantContext;
  args: TArgs;
}

function fail<T>(reason: VendorUnavailableReason, error: string): VendorResult<T> {
  return { available: false, error, reason, data: null };
}

function ok<T>(data: T): VendorResult<T> {
  return { available: true, error: null, reason: null, data };
}

function isTimeoutError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false;
  return err.name === 'TimeoutError' || err.name === 'AbortError';
}

export function runVendor<TArgs, TData>(
  descriptor: FreeVendorDescriptor<TArgs, TData>,
  input: RunVendorInput<TArgs>,
): Promise<VendorResult<TData>>;
export function runVendor<TArgs, TData>(
  descriptor: MeteredVendorDescriptor<TArgs, TData>,
  input: RunVendorInput<TArgs> & { spend: SpendAuthorisation },
): Promise<VendorResult<TData>>;
export async function runVendor<TArgs, TData>(
  descriptor: VendorDescriptor<TArgs, TData>,
  input: RunVendorInput<TArgs> & { spend?: SpendAuthorisation },
): Promise<VendorResult<TData>> {
  try {
    if (descriptor.killSwitch()) {
      return unavailable(descriptor, 'killed', `${descriptor.id} kill switch is on`);
    }
  } catch (err) {
    return unavailable(descriptor, 'remote_error', errorMessage(err));
  }

  try {
    const configured = descriptor.configured();
    if (!configured.ok) {
      return unavailable(descriptor, 'not_configured', `${configured.missing} is not configured`);
    }
  } catch (err) {
    return unavailable(descriptor, 'remote_error', errorMessage(err));
  }

  if (descriptor.call === null) {
    return unavailable(descriptor, 'not_implemented', `${descriptor.id} is not implemented`);
  }

  const spend = 'spend' in input ? input.spend : undefined;
  if (descriptor.cost === 'metered') {
    if (!isIssuedSpend(spend)) {
      return unavailable(descriptor, 'unauthorised_spend', 'metered vendor requires SpendAuthorisation');
    }
    // Issued is not enough — a grant for vendor A must not authorise a pull on vendor B.
    if (spend.vendorId !== descriptor.id) {
      return unavailable(descriptor, 'unauthorised_spend', 'spend token is bound to a different vendor');
    }
  }

  let attemptId: string | null = null;

  try {
    if (descriptor.cost === 'metered' && spend) {
      // Ledger insert is fail-close: a throw here skips `call` (no second chance to bill).
      const attempt = await recordAttempt({
        ctx: input.ctx,
        vendorId: descriptor.id,
        caseId: spend.caseId,
      });
      attemptId = attempt.id;
      await auditFromContext(input.ctx, {
        action: `${descriptor.auditAction}.attempt`,
        status: 'ok',
        resourceType: 'verification_vendor',
        resourceId: descriptor.id,
        detail: { phase: 'pending', caseId: spend.caseId },
      });
    }
    // URL/arg construction belongs inside `call` (see fmcsaQcMobile / socrataClient).
    // Wrapping the invoke is what keeps a thrown builder from escaping.
    const data = await descriptor.call(input.args);
    if (attemptId) await resolveAttempt(attemptId, 'ok');
    if (descriptor.cost === 'metered') {
      await auditFromContext(input.ctx, {
        action: descriptor.auditAction,
        status: 'ok',
        resourceType: 'verification_vendor',
        resourceId: descriptor.id,
      });
    }
    return ok(data);
  } catch (err) {
    if (attemptId) await resolveAttempt(attemptId, 'error');
    const reason: VendorUnavailableReason = isTimeoutError(err) ? 'timeout' : 'remote_error';
    if (descriptor.cost === 'metered') {
      await auditFromContext(input.ctx, {
        action: descriptor.auditAction,
        status: 'error',
        resourceType: 'verification_vendor',
        resourceId: descriptor.id,
        detail: { reason },
      });
    }
    return unavailable(descriptor, reason, errorMessage(err));
  }
}

/** One warn per unavailable result. Never args, never URLs, never keys. */
function unavailable<T>(
  descriptor: { id: string },
  reason: VendorUnavailableReason,
  error: string,
): VendorResult<T> {
  logger.warn({ vendorId: descriptor.id, reason }, 'verification vendor unavailable');
  return fail(reason, error);
}
