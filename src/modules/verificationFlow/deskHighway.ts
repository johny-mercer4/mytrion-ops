/**
 * Phase 8 — the Highway operational review, saved.
 *
 * WHY THIS EXISTS AT ALL. `buildSummary` assembles the sixteen things the SOP says the underwriting
 * summary must carry, and one of them is "Highway findings" — which it reads from this phase's
 * `findings` jsonb. Nothing has ever written that column, so the line has been empty on every case
 * since the summary was built. This is the writer.
 *
 * NO API AND NO TABLE. There is no Highway integration, so every figure arrives typed by the agent who
 * read it off Highway; and the phase row's `findings` already exists and is already the summary's
 * source, so a dedicated table would be a migration for a column we would then have to teach the
 * summary about. The field NAMES mirror the warehouse Highway snapshot's columns
 * (`safety_csa_percentile`, `authority_common_age_months`, `equipment_observed_power_units`, …) so
 * wiring a parser later is a mapping and not a rewrite of the pane.
 *
 * CARRIER ONLY, refused loudly for anyone else — `p8_highway` does not apply to an owner-operator, and
 * `buildRail` renders a phase's findings even when `applies` is false, so a blob written here would
 * put a Highway panel underneath "Not applicable".
 */
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import { VERIFICATION_PHASE, type VerificationCase } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { AppError } from '../../lib/errors.js';

/**
 * What the pane sends. Every field optional and nullable: this is filled over more than one sitting,
 * and a figure Highway does not show must be storable as "absent" rather than as zero.
 */
export interface HighwayReviewInput {
  safetyRating?: string | null | undefined;
  safetyCsaPercentile?: number | null | undefined;
  safetyTotalViolations?: number | null | undefined;
  safetyTrend?: string | null | undefined;
  bluewireScore?: number | null | undefined;
  observedPowerUnits?: number | null | undefined;
  reportedPowerUnits?: number | null | undefined;
  connectedTrucks?: number | null | undefined;
  eldStatus?: string | null | undefined;
  insuranceLimit?: number | null | undefined;
  insuranceExpiry?: string | null | undefined;
  authorityAgeMonths?: number | null | undefined;
  operatingStatus?: string | null | undefined;
  currentActivity?: string | null | undefined;
  /** The eleven SOP rows, as the reviewer ruled on them. */
  checks?: Record<string, string> | null | undefined;
  verdict?: string | null | undefined;
  note?: string | null | undefined;
}

/**
 * Store the review on the phase row.
 *
 * `recordPhaseObservation`, not `upsertPhase`: a reviewer correcting one figure on a Phase 8 they have
 * already passed must not have that pass silently withdrawn. `upsertPhase` writes outcome/decidedAt/
 * decidedBy as `?? null` unconditionally — see the repo method's own comment.
 *
 * `source: 'manual'` is on the blob deliberately. When a parser eventually fills these, the summary and
 * any later reader need to be able to tell a figure a human read off a screen from one a machine
 * scraped, and adding that distinction afterwards means guessing about every row already stored.
 */
export async function saveHighwayReview(
  ctx: TenantContext,
  row: VerificationCase,
  input: HighwayReviewInput,
): Promise<void> {
  if (row.applicantType !== 'carrier') {
    throw new AppError(
      'The Highway operational review applies to carriers only — this applicant has no carrier operation to review.',
      { statusCode: 409, code: 'VERIFICATION_PHASE_NOT_APPLICABLE', expose: true },
    );
  }

  await verificationCaseAssetRepo.recordPhaseObservation(ctx, row.id, {
    phaseCode: VERIFICATION_PHASE.highway,
    status: 'in_progress',
    findings: {
      source: 'manual',
      recordedAt: new Date().toISOString(),
      /**
       * The cards the APPLICATION asked for, stored beside the fleet Highway showed.
       *
       * Kept on the blob rather than left to be re-joined later because the SOP's indicator is the
       * comparison of these two, and `fuel_cards_requested` is editable on Phase 5 — a summary that
       * re-read it months later could report a ratio the reviewer never saw.
       */
      cardsRequestedAtReview: row.fuelCardsRequested,
      ...input,
    },
  });
}
