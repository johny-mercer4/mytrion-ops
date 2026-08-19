/**
 * Who may hard-delete a manually-entered payment_transactions row, beyond the base admin bypass.
 *
 * Deliberately its own tiny module rather than folded into mytrionAccessService: that resolver is
 * the Mytrion/department-access authority (profile defaults -> role defaults -> per-user override
 * -> permission sets), explicitly documented as a workspace-level boundary, not an individual-
 * action one — bolting an unrelated "can delete a Chase row" permission onto it would blur what it
 * means for anyone reading it later. This is a flat, single-purpose check instead.
 */
import type { TenantContext } from '../../types/tenantContext.js';
import { paymentDeleteGrantRepo } from '../../repos/paymentDeleteGrantRepo.js';

/** Admins / all-department / break-glass never need an explicit grant row. */
function isAdminLike(ctx: TenantContext): boolean {
  return ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess === true;
}

/** Whether `ctx` may delete a manually-entered payment_transactions row of this source. */
export async function canDeletePaymentTransaction(ctx: TenantContext, source: string): Promise<boolean> {
  if (isAdminLike(ctx)) return true;
  // ctx.userId is `zoho:<id>` for a verified worker session (zohoAuthService.ts) — grants are keyed
  // on the bare id (same convention as auth.routes.ts /auth/me and every other zoho: strip site).
  // Missing this turns every grant into a silent no-op: the frontend hint (canDeleteChaseTransactionsFact,
  // which strips it) would show the button, but this check would never match a real grant row.
  const zohoUserId = ctx.userId.replace(/^zoho:/, '');
  return paymentDeleteGrantRepo.isGranted(zohoUserId, source);
}

/**
 * Session-payload FACT for the frontend's delete-button visibility — a courtesy, not a grant (same
 * convention as auth.routes.ts's leadsTeamFor). The real gate is canDeletePaymentTransaction above,
 * re-checked server-side on the actual delete route; this only decides whether to show the button.
 * Fails closed (false) on any error — worst case the button doesn't render for someone who has the
 * grant, not the reverse.
 */
export async function canDeleteChaseTransactionsFact(zohoUserId: string): Promise<boolean> {
  try {
    return await paymentDeleteGrantRepo.isGranted(zohoUserId, 'chase');
  } catch {
    return false;
  }
}
