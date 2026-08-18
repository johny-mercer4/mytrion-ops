/**
 * Carrier money facts for the mini-app self-service reads — the balance itself, and the
 * account-type rule that decides how a money-code draw window is computed.
 *
 * servercrm exposes the balance twice: `/carrier-balance` (dedicated, richest payload) and
 * `/carrier-overview` (the same money fields bundled with debt + cards). They do not fail
 * together, which is what this module exists for.
 */
import { logger } from '../../lib/logger.js';
import { serverCrmWrapper, type CarrierBalance, type MoneyCodePreview } from '../../wrappers/serverCrmWrapper.js';

/** The overview fields that overlap `CarrierBalance`. servercrm types nothing; read defensively. */
interface OverviewMoneyFields {
  account_type?: unknown;
  payment_terms?: unknown;
  company_name?: unknown;
  credit_limit?: unknown;
  efs_balance?: unknown;
  efs_error?: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** servercrm sends money as `number | numeric-string | null`. Anything else is not a figure. */
function toAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Resolve the carrier's balance, falling back to the overview when the dedicated endpoint fails.
 *
 * Owner feedback 2026-08-07: the Balance Check sheet dead-ended on "Couldn't load this" while the
 * Account Status sheet — which reads `/carrier-overview` and swallows its own `/carrier-balance`
 * call — rendered fine for the same owner on the same account. A hard 502 on the ONE screen whose
 * entire job is the balance is not an acceptable degradation when the same figure is one call
 * away. The fallback narrows the payload (no credit_used/credit_remaining in the overview), so the
 * optional tiles simply hide rather than the sheet dying.
 *
 * If the overview fails too the error propagates — that is a real upstream outage, and the sheet's
 * retry affordance is the right answer to it.
 */
export async function resolveCarrierBalance(carrierId: string): Promise<CarrierBalance> {
  try {
    return await serverCrmWrapper.getCarrierBalance(carrierId);
  } catch (err) {
    // Logged, not silent: the fallback keeps the sheet alive, and the only remaining signal that
    // the dedicated endpoint is down is this line.
    logger.warn({ err, carrierId }, '[carrier-balance] /carrier-balance failed; falling back to /carrier-overview');
    const overview = (await serverCrmWrapper.getCarrierOverview(carrierId)) as OverviewMoneyFields;
    return {
      account_type: str(overview.account_type) ?? null,
      payment_terms: str(overview.payment_terms) ?? null,
      company_name: str(overview.company_name) ?? null,
      credit_limit: toAmount(overview.credit_limit),
      efs_balance: toAmount(overview.efs_balance),
      efs_error: str(overview.efs_error) ?? null,
    };
  }
}

/**
 * Is this a prepaid arrangement rather than a line of credit?
 *
 * Same vocabulary as the Billing Ledger's `normalizeClientType` (modules/billing/ledger/
 * clientType.ts): 'Prepay' and 'Deposit' are both prepaid, everything else is LOC or untyped.
 * Duplicated as a three-line check rather than imported so this stays a pure string test with no
 * DWH pool or override-repo import behind it.
 */
export function isPrepayCarrier(balance: CarrierBalance): boolean {
  const raw = (str(balance.account_type) ?? str(balance['payment_terms']) ?? '').trim().toUpperCase();
  return raw === 'PREPAY' || raw === 'DEPOSIT';
}

/**
 * Prepay-aware money-code window.
 *
 * servercrm computes `available` as a percentage of the carrier's latest invoice. A prepay account
 * has no invoice draw window at all, so that rule returns 0 for every one of them — owner feedback
 * 2026-08-07: "Available to draw shows $0.00 for prepay clients too". Their drawable money is
 * simply the prepaid balance sitting in EFS, which is exactly what `efs_balance` means for a
 * prepay account (see CarrierBalance in the wrapper).
 *
 * LOC accounts are untouched: servercrm stays the only source of truth for a credit-line window.
 * `available_source` is stamped so a support agent reading the payload can tell which rule
 * produced the figure. servercrm's draw endpoint still validates the amount itself — this changes
 * what the owner is SHOWN, not what upstream will accept.
 */
export async function withPrepayDrawWindow(
  carrierId: string,
  preview: MoneyCodePreview,
): Promise<MoneyCodePreview> {
  const balance = await resolveCarrierBalance(carrierId).catch(() => null);
  if (!balance || !isPrepayCarrier(balance)) return preview;
  const prepaid = toAmount(balance.efs_balance);
  // EFS unreachable (efs_balance null) must not read as "no money" — leave the upstream figure and
  // its own eligibility verdict alone rather than asserting a zero window we did not measure.
  if (prepaid == null) return preview;
  const available = Math.max(0, prepaid);
  return { ...preview, available, eligible: available > 0, available_source: 'prepay_balance' };
}
