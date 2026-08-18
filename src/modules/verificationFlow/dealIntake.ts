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
  /** `Deals.Cards_Requested` — the SOP's "Number of fuel cards requested". */
  cardsRequested?: string | null;
  secondaryEmail?: string | null;
  alternativeContact?: string | null;
  businessType?: string | null;
  zohoStage?: string | null;
  applicationStatus?: string | null;
  applicationDate?: string | null;
  zohoOwnerId?: string | null;
  zohoOwnerName?: string | null;
  zohoRaw?: Record<string, unknown> | undefined;
}

/**
 * Zoho's `Deals.Business_Type` values that mean a HUMAN is the applicant, not a company.
 *
 * These are two of the sixteen values in the picklist; everything else in it
 * (Corporation, Limited Liability Company, LLC, Partnership, Non-profit, Trust, …) is a company.
 * Matched exactly rather than by keyword: "Sole Proprietorship" is the value, and a substring
 * search for "person" would also catch "Public Accounting Firm" style additions later.
 */
const INDIVIDUAL_BUSINESS_TYPES = new Set(['sole proprietorship', 'natural person']);

/**
 * The applicant type from what Zoho actually KNOWS — or null, and Sales decides.
 *
 * TWO types exist: `owner_operator` (Flow A, "Owner-Operator / Individual") and `carrier`
 * (Flow B, "Carrier (Company)"). The old third value `company` is no longer produced here; it is
 * still accepted on read because rows already carry it.
 *
 * WHY THIS STOPPED GUESSING. The previous version read any non-empty `mc`/`dot` as authority and
 * otherwise ran a regex for "llc|inc|corp|…" over the company name. Both were wrong on live data:
 * Zoho's MC field holds the literal `No assigned number` on 13 of 26 cases, so TEN cases with no
 * authority at all were typed `carrier`; and the name regex cannot tell an owner-operator trading
 * as "Karimov Trucking LLC" from a fleet. Truck count is no help either — a one-truck applicant is
 * very often a company.
 *
 * So the only signals used are ones Zoho states rather than implies:
 *   a real MC or USDOT      -> carrier. Only a company holds operating authority.
 *   Business_Type is        -> owner_operator.
 *     Sole Proprietorship
 *     or Natural Person
 *   anything else           -> null. Sales picks it on the intake form, which is where somebody
 *                              who has spoken to the applicant can answer in one click.
 *
 * Returning null is not a failure mode: `intake.ts` surfaces "Applicant type" as the first missing
 * item, so the case is visibly waiting on a human rather than silently mis-typed.
 */
export function inferApplicantType(deal: DealIntakeInput): VerificationApplicantType | null {
  // `mc`/`dot` reach here already stripped of Zoho's sentinels by `authorityNumber` in the mapper,
  // so a non-empty value here really is an authority number.
  if (deal.mc?.trim() || deal.dot?.trim()) return 'carrier';

  const businessType = deal.businessType?.trim().toLowerCase() ?? '';
  if (INDIVIDUAL_BUSINESS_TYPES.has(businessType)) return 'owner_operator';

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
 * `ownerZohoUserId` is the DEAL's owner — the Sales agent who will complete intake — and ONLY that.
 *
 * It used to fall back to the configured credit agent whenever a Deal arrived unowned, and that was a
 * real leak rather than a cosmetic one: `verificationFlowRepo.salesOwnership` ORs this column into the
 * SALES list scope, and `applicationService.assertSalesMayEdit` ORs it into the Sales WRITE gate. So a
 * credit agent found other people's applications in their own Sales Verification tab, with edit
 * rights on the intake. The desk's assignee now has columns of its own
 * (`verification_owner_zoho_user_id`, written by Stage-0 routing), and migration 0129 moves the rows
 * the fallback had already mislabelled.
 *
 * An unowned Deal therefore leaves BOTH Sales columns empty. That is the honest state — the Sales
 * queue shows nobody because nobody in Sales owns it — and `zohoDealIngest` logs it loudly, because
 * the fix is in Zoho rather than here.
 */
export async function createApplicationFromDeal(
  ctx: TenantContext,
  deal: DealIntakeInput,
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

    // The Sales agent who owns the Deal owns the intake. Nothing else makes this row findable from
    // the Sales desk — and nothing but a Sales agent belongs in it (see the docblock).
    // Empty string rather than null: both columns are NOT NULL, and `salesOwnerName` already reads a
    // blank as "no Sales owner", which is the truth for a Deal nobody owns.
    ownerZohoUserId: salesOwner ?? '',
    ownerName: clean(deal.zohoOwnerName) ?? '',
    zohoOwnerId: salesOwner,
    zohoOwnerName: clean(deal.zohoOwnerName),

    companyName: clean(deal.companyName),
    firstName: clean(deal.firstName),
    lastName: clean(deal.lastName),
    // Contact is a Phase-1 requirement for BOTH flows, so take the fallback Zoho already holds
    // rather than making Sales retype something the Deal knows.
    email: clean(deal.email) ?? clean(deal.secondaryEmail),
    phone: clean(deal.phone) ?? clean(deal.cell) ?? clean(deal.alternativeContact),
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
    // Reuses `parseTrucks`: same problem, same answer — Zoho stores the count as text, and a
    // non-numeric or zero value is no information rather than a request for zero cards.
    fuelCardsRequested: parseTrucks(deal.cardsRequested),
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
