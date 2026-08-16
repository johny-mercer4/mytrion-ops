/**
 * Zoho Deal → new-era application record.
 *
 * Applications are NOT hand-created. A Deal reaching an application stage in Zoho is the trigger;
 * the nightly poll (`automation.verification.case-ingest`) turns it into one shared
 * `verification_cases` row that both desks then work — Sales completing intake, Verification
 * underwriting it. That is the SOP's own "Zoho -> Mytrion -> Credit Decision" spine.
 *
 * The row lands RED (`verification_process = false`) with the phase rail seeded and the missing
 * list already computed, so the Sales agent opens it and immediately sees what they owe. Nothing
 * here touches the retired credit_platform pipeline.
 */
import { logger } from '../../lib/logger.js';
import { errorMessage } from '../../lib/errors.js';
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import { VERIFICATION_PHASE, VERIFICATION_STATUS } from '../../db/schema/verification_flow.js';
import type { VerificationApplicantType } from '../../db/schema/verification_flow.js';
import type { VerificationCase } from '../../db/schema/verification_cases.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { PHASE_CATALOG, applicablePhases, skipReason } from './phases.js';
import { applicationService } from './applicationService.js';

/** The subset of a mapped Zoho Deal this module needs. Keeps the legacy mapper at arm's length. */
export interface DealIntakeInput {
  zohoDealId: string;
  zohoApplicationId?: string | null;
  carrierId?: string | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  cell?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  dateOfBirth?: string | null;
  dot?: string | null;
  mc?: string | null;
  truckCount?: string | null;
  businessType?: string | null;
  zohoStage?: string | null;
  applicationStatus?: string | null;
  applicationDate?: string | null;
  zohoOwnerId?: string | null;
  zohoOwnerName?: string | null;
  zohoRaw?: Record<string, unknown> | undefined;
}

const COMPANY_HINT = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co\.|company|ltd|limited)\b/i;

/**
 * Guess the applicant type from what Zoho already knows.
 *
 * Only a CONFIDENT signal produces a value; otherwise this returns null and the intake evaluator
 * lists "applicant type" as the first missing item. Guessing wrong is worse than asking: the type
 * decides which half of the SOP's Flow A / Flow B form the agent fills, and which phases apply.
 */
export function inferApplicantType(deal: DealIntakeInput): VerificationApplicantType | null {
  const hasAuthority = Boolean(deal.mc?.trim()) || Boolean(deal.dot?.trim());
  if (hasAuthority) return 'carrier';

  const name = `${deal.companyName ?? ''} ${deal.businessType ?? ''}`;
  // An incorporated name with no MC/DOT is exactly the SOP's "LLC / corporation without MC/DOT",
  // which routes to manager review rather than through the carrier phases.
  if (COMPANY_HINT.test(name)) return 'company';

  return null;
}

/** Zoho stores truck count as free text. A non-numeric value is no information, not a zero. */
function parseTrucks(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const clean = (v: string | null | undefined): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
};

/**
 * Create one application from a Deal, red and ready for Sales.
 *
 * `ownerZohoUserId` is the DEAL's owner — the Sales agent who will complete intake. The
 * Verification desk sees every case regardless of owner, so there is no second assignment to make
 * here; putting the Verification owner on the row instead is what would hide the application from
 * the person who has to fill it in.
 */
export async function createApplicationFromDeal(
  ctx: TenantContext,
  deal: DealIntakeInput,
  opts: { fallbackOwnerZohoUserId: string; fallbackOwnerName: string },
): Promise<VerificationCase> {
  const applicantType = inferApplicantType(deal);
  const salesOwner = clean(deal.zohoOwnerId);

  // A Deal with no owner in Zoho still represents a real application, so it is created rather than
  // dropped — but `zoho_owner_id` stays null so the Sales list does not claim an agent that does
  // not exist. It surfaces on the Verification queue as awaiting Sales with nobody assigned, which
  // is the visible version of this problem. Loud, because the fix is in Zoho, not here.
  if (!salesOwner) {
    logger.warn(
      { dealId: deal.zohoDealId, companyName: deal.companyName },
      'verification deal intake: Deal has no owner — application created unassigned, no Sales agent will see it',
    );
  }

  const created = await verificationFlowRepo.insert(ctx, {
    origin: 'zoho_deal',
    zohoDealId: deal.zohoDealId,
    zohoApplicationId: clean(deal.zohoApplicationId),
    carrierId: clean(deal.carrierId),

    // The Sales agent who owns the Deal owns the intake. Nothing else makes this row findable
    // from the Sales desk.
    ownerZohoUserId: salesOwner ?? opts.fallbackOwnerZohoUserId,
    ownerName: clean(deal.zohoOwnerName) ?? opts.fallbackOwnerName,
    zohoOwnerId: salesOwner,
    zohoOwnerName: clean(deal.zohoOwnerName),

    companyName: clean(deal.companyName),
    firstName: clean(deal.firstName),
    lastName: clean(deal.lastName),
    email: clean(deal.email),
    phone: clean(deal.phone) ?? clean(deal.cell),
    cell: clean(deal.cell),
    address: clean(deal.address),
    city: clean(deal.city),
    state: clean(deal.state),
    zip: clean(deal.zip),
    dateOfBirth: clean(deal.dateOfBirth),
    dot: clean(deal.dot),
    mc: clean(deal.mc),
    trucksCount: parseTrucks(deal.truckCount),
    truckCount: clean(deal.truckCount),
    businessType: clean(deal.businessType),
    zohoStage: clean(deal.zohoStage),
    applicationStatus: clean(deal.applicationStatus),
    applicationDate: clean(deal.applicationDate),
    zohoRaw: deal.zohoRaw ?? {},

    ...(applicantType ? { applicantType } : {}),

    // Red until Sales completes intake. Stated explicitly rather than left to the column default,
    // because this is the one invariant the whole two-desk flow rests on.
    verificationProcess: false,
    phaseCode: VERIFICATION_PHASE.intake,
    statusCode: VERIFICATION_STATUS.intakeIncomplete,
    distributeType: 'shared',
    status: 'new',
  });

  // Seed the rail up front so the Sales progress view has something true to render from the first
  // second, rather than an empty list that reads as "nothing is happening".
  const applicable = new Set(applicablePhases(applicantType).map((p) => p.code));
  await verificationCaseAssetRepo.seedPhases(
    ctx,
    created.id,
    PHASE_CATALOG.map((p) => ({
      phaseCode: p.code,
      status: applicable.has(p.code) ? ('not_started' as const) : ('skipped' as const),
      note: skipReason(p, applicantType),
    })),
  );

  // Compute the missing list now. Without this the card is red with an empty "outstanding" count
  // until someone touches it, which reads as a bug rather than as work to do.
  try {
    await applicationService.refreshGate(ctx, created.id);
  } catch (err) {
    logger.warn(
      { err: errorMessage(err), caseId: created.id, dealId: deal.zohoDealId },
      'verification deal intake: gate refresh failed, row left red with no missing list',
    );
  }

  return created;
}
