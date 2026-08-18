/**
 * Sales-side service: create, fill and submit an application.
 *
 * THE GATE IS COMPUTED HERE AND NOWHERE ELSE. Every mutation ends by re-deriving completeness from
 * the STORED row plus its stored principals and documents, then writing the verdict. A client that
 * posts `verificationProcess: true` changes nothing — the field is not in the patch type and the
 * value written is always the one this module computed.
 *
 * Deploy-order guard: the flow tables arrive in migration 0121, so a deploy that lands ahead of its
 * migration returns a friendly 503 naming the migration rather than a bare 500. Same treatment
 * `verificationCases.ts` gives `VERIFICATION_CASES_NOT_MIGRATED`.
 */
import { AppError, NotFoundError } from '../../lib/errors.js';
import { isMissingColumn, isMissingTable } from '../../repos/util.js';
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import { verificationPolicyRepo } from '../../repos/verificationReviewRepo.js';
import {
  VERIFICATION_STATUS,
  type VerificationApplicantType,
  type VerificationCase,
  type VerificationCaseDocument,
  type VerificationCasePrincipal,
} from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { evaluateIntakeCompleteness, missingFieldKeys, type IntakeVerdict } from './intake.js';
import {
  applicablePhases,
  buildRail,
  PHASE_CATALOG,
  skipReason,
  type RailPhase,
} from './phases.js';
import {
  requiresManagerReviewAtIntake,
  resolveReviewOrder,
  resolveUnderwritingRoute,
} from './stateMachine.js';

/**
 * EVERY table migration 0121 creates — not a sample.
 *
 * An earlier cut listed four of the twelve, which meant the most commonly hit one
 * (`verification_statuses`, read by every list call) fell straight through the guard and surfaced
 * as a bare 500 on an environment that simply had not run the migration. That is the exact failure
 * this function exists to prevent, so the list is now complete and
 * `verification-flow-schema-guard.test.ts` fails if 0121 ever creates a table missing from it.
 */
export const FLOW_TABLES = [
  'verification_phases',
  'verification_statuses',
  'verification_case_phases',
  'verification_case_events',
  'verification_case_principals',
  'verification_case_documents',
  'verification_blacklist_entries',
  'verification_screening_hits',
  'verification_credit_reviews',
  'verification_banking_reviews',
  'verification_risk_assessments',
  'verification_policy',
] as const;

/**
 * Map a deploy-ahead-of-migration failure onto an actionable 503.
 *
 * Covers both shapes: a table that does not exist yet (42P01) and — the half that actually bites
 * more often — `verification_cases` existing but lacking the columns 0121 adds (42703), which is
 * what an environment one migration behind looks like.
 */
export function asFlowSchemaError(err: unknown): AppError | null {
  const missing =
    FLOW_TABLES.some((t) => isMissingTable(err, t) || isMissingColumn(err, t)) ||
    isMissingTable(err, 'verification_cases') ||
    isMissingColumn(err, 'verification_cases') ||
    isMissingColumn(err, 'verification_banking_reviews');
  if (!missing) return null;
  return new AppError(
    'The verification underwriting tables are not migrated on this database. Run `pnpm db:migrate` against it — migrations 0121_verification_new_era and 0122_verification_banking_consistency.',
    { statusCode: 503, code: 'VERIFICATION_FLOW_NOT_MIGRATED', expose: true },
  );
}

/** Wrap a call so every route gets the friendly schema error without repeating the try/catch. */
export async function withFlowSchemaGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const mapped = asFlowSchemaError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

export function zohoFromCtx(ctx: TenantContext): string | undefined {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : undefined;
}

function isAdmin(ctx: TenantContext): boolean {
  return ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess === true;
}

export interface ApplicationDetail {
  case: VerificationCase;
  principals: VerificationCasePrincipal[];
  documents: VerificationCaseDocument[];
  intake: IntakeVerdict;
  /**
   * The 10-phase rail, read-only for Sales.
   *
   * Sales needs to see where underwriting has got to and where it stopped — "it is with
   * Verification" is not an answer an agent can give a carrier. Same rows the desk works, projected
   * rather than duplicated.
   */
  phases: RailPhase[];
  /** Derived, not stored — recomputed from the current card count so it cannot go stale. */
  underwritingRoute: 'octane_internal' | 'wex';
  reviewOrder: 'banking_first' | 'credit_first';
}

/** The fields Sales may write. Anything not listed here is not theirs to set. */
export interface IntakePatch {
  applicantType?: VerificationApplicantType;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  ssnLast4?: string | null;
  dlLast4?: string | null;
  dlState?: string | null;
  residentialAddress?: string | null;
  businessAddress?: string | null;
  ein?: string | null;
  mc?: string | null;
  dot?: string | null;
  trucksCount?: number | null;
  fuelCardsRequested?: number | null;
  requestedLimit?: string | null;
  bankingSource?: 'statements' | 'plaid' | null;
  plaidConnected?: boolean;
}

/**
 * Re-derive the gate from stored state and persist it.
 *
 * Returns the refreshed case. Called after EVERY mutation — patch, principal add/remove, document
 * add/remove — so the red card's missing list can never describe a state the row is no longer in.
 */
async function refreshGate(
  ctx: TenantContext,
  caseId: string,
  opts: { submitting?: boolean; actor?: string | undefined; actorName?: string | undefined } = {},
): Promise<ApplicationDetail> {
  const row = await verificationFlowRepo.findById(ctx, caseId);
  if (!row) throw new NotFoundError('Application not found');

  const [principals, documents, seededPhases] = await Promise.all([
    verificationCaseAssetRepo.listPrincipals(ctx, caseId),
    verificationCaseAssetRepo.listDocuments(ctx, caseId),
    verificationCaseAssetRepo.listPhases(ctx, caseId),
  ]);

  const verdict = evaluateIntakeCompleteness(
    {
      applicantType: row.applicantType,
      firstName: row.firstName,
      lastName: row.lastName,
      companyName: row.companyName,
      dateOfBirth: row.dateOfBirth,
      dlLast4: row.dlLast4,
      ssnLast4: row.ssnLast4,
      residentialAddress: row.residentialAddress,
      businessAddress: row.businessAddress,
      ein: row.ein,
      mc: row.mc,
      dot: row.dot,
      email: row.email,
      phone: row.phone,
      trucksCount: row.trucksCount,
      fuelCardsRequested: row.fuelCardsRequested,
      requestedLimit: row.requestedLimit,
      bankingSource: row.bankingSource,
      plaidConnected: row.plaidConnected,
    },
    principals,
    documents,
  );

  // The gate only OPENS on an explicit submit. Saving a form that happens to be complete leaves the
  // case a draft — releasing work to another department is a decision the agent makes, not a
  // side-effect of typing the last field.
  const alreadyOpen = row.verificationProcess;
  const shouldOpen = verdict.complete && (opts.submitting === true || alreadyOpen);

  const statusCode = shouldOpen
    ? row.statusCode === VERIFICATION_STATUS.intakeIncomplete
      ? VERIFICATION_STATUS.intakeSubmitted
      : row.statusCode
    : VERIFICATION_STATUS.intakeIncomplete;

  /**
   * Only WRITE when the stored verdict is actually stale.
   *
   * This function runs on every read as well as every mutation, and it used to issue an UPDATE each
   * time — a write per page view, against a database ~300ms away. Comparing first makes the common
   * case (opening an application that has not changed) a pure read.
   */
  const missing = missingFieldKeys(verdict);
  const stored = row.intakeMissing ?? [];
  const unchanged =
    row.verificationProcess === shouldOpen &&
    row.statusCode === statusCode &&
    stored.length === missing.length &&
    stored.every((f, i) => f === missing[i]);

  const updated = unchanged
    ? row
    : await verificationFlowRepo.setGate(ctx, caseId, {
        complete: shouldOpen,
        missing,
        statusCode,
        submittedByZohoUserId: opts.actor,
        actorName: opts.actorName,
      });
  if (!updated) throw new NotFoundError('Application not found');

  // Crossing into the desk seeds the phase rail, so Verification opens a case with its skips
  // already stated rather than an empty rail it has to interpret.
  if (shouldOpen && !alreadyOpen) {
    await seedPhaseRail(ctx, updated);
  }

  // Re-read only when the rail was just written; otherwise the list fetched above is current.
  const phases = buildRail(
    shouldOpen && !alreadyOpen ? await verificationCaseAssetRepo.listPhases(ctx, caseId) : seededPhases,
    updated.applicantType,
  );

  const policy = await verificationPolicyRepo.routing(ctx);
  return {
    case: updated,
    principals,
    documents,
    intake: verdict,
    phases,
    underwritingRoute: resolveUnderwritingRoute(updated.fuelCardsRequested, policy),
    reviewOrder: resolveReviewOrder(updated.applicantType, updated.trucksCount, policy),
  };
}

/** Write one phase row per phase, marking the inapplicable ones `skipped` with a stated reason. */
async function seedPhaseRail(ctx: TenantContext, row: VerificationCase): Promise<void> {
  const applicable = new Set(applicablePhases(row.applicantType).map((p) => p.code));
  await verificationCaseAssetRepo.seedPhases(
    ctx,
    row.id,
    PHASE_CATALOG.map((p) => ({
      phaseCode: p.code,
      status: applicable.has(p.code) ? ('not_started' as const) : ('skipped' as const),
      note: skipReason(p, row.applicantType),
    })),
  );
}

export const applicationService = {
  /** Create an empty draft owned by the calling agent. Red from the moment it exists. */
  async create(
    ctx: TenantContext,
    input: {
      applicantType?: VerificationApplicantType | undefined;
      companyName?: string | undefined;
      ownerName?: string | undefined;
    },
  ): Promise<ApplicationDetail> {
    return withFlowSchemaGuard(async () => {
      const actor = zohoFromCtx(ctx) ?? ctx.userId;
      const created = await verificationFlowRepo.insert(ctx, {
        ownerZohoUserId: actor,
        ownerName: input.ownerName ?? ctx.userId,
        submittedByZohoUserId: actor,
        origin: 'sales_application',
        ...(input.applicantType ? { applicantType: input.applicantType } : {}),
        ...(input.companyName ? { companyName: input.companyName } : {}),
      });
      return refreshGate(ctx, created.id, { actor });
    });
  },

  async get(ctx: TenantContext, caseId: string): Promise<ApplicationDetail> {
    return withFlowSchemaGuard(() => refreshGate(ctx, caseId));
  },

  /**
   * Non-admin Sales agents may only touch their own applications, and only while the desk has not
   * taken over. Once Verification is working a case, Sales edits would move ground under a reviewer.
   */
  async assertSalesMayEdit(ctx: TenantContext, caseId: string): Promise<VerificationCase> {
    const row = await verificationFlowRepo.findById(ctx, caseId);
    if (!row) throw new NotFoundError('Application not found');

    if (!isAdmin(ctx)) {
      const self = zohoFromCtx(ctx);
      // Same three routes as the list query — a cron-created application reaches its agent via
      // `zohoOwnerId`, and an agent who can see a row but not edit it is a dead end.
      const owns =
        row.submittedByZohoUserId === self ||
        row.ownerZohoUserId === self ||
        row.zohoOwnerId === self;
      if (!owns) {
        throw new AppError('You can only edit applications you raised.', {
          statusCode: 403,
          code: 'VERIFICATION_NOT_YOUR_APPLICATION',
          expose: true,
        });
      }
    }

    // Pending Documents is the one open state where Sales SHOULD write — the desk asked them to.
    const editable =
      !row.verificationProcess ||
      row.statusCode === VERIFICATION_STATUS.intakeSubmitted ||
      row.statusCode === VERIFICATION_STATUS.pendingDocs;
    if (!editable) {
      throw new AppError(
        'This application is being underwritten by Verification and can no longer be edited from Sales.',
        { statusCode: 409, code: 'VERIFICATION_LOCKED', expose: true },
      );
    }
    return row;
  },

  async patch(ctx: TenantContext, caseId: string, patch: IntakePatch): Promise<ApplicationDetail> {
    return withFlowSchemaGuard(async () => {
      await this.assertSalesMayEdit(ctx, caseId);
      await verificationFlowRepo.patchIntake(ctx, caseId, patch);
      return refreshGate(ctx, caseId, { actor: zohoFromCtx(ctx) });
    });
  },

  async addPrincipal(
    ctx: TenantContext,
    caseId: string,
    input: {
      fullName: string;
      role?: string | undefined;
      ownershipPct?: string | undefined;
      dateOfBirth?: string | undefined;
      ssnLast4?: string | undefined;
      phone?: string | undefined;
      email?: string | undefined;
      address?: string | undefined;
    },
  ): Promise<ApplicationDetail> {
    return withFlowSchemaGuard(async () => {
      await this.assertSalesMayEdit(ctx, caseId);
      await verificationCaseAssetRepo.addPrincipal(ctx, { caseId, ...input });
      return refreshGate(ctx, caseId, { actor: zohoFromCtx(ctx) });
    });
  },

  async removePrincipal(
    ctx: TenantContext,
    caseId: string,
    principalId: string,
  ): Promise<ApplicationDetail> {
    return withFlowSchemaGuard(async () => {
      await this.assertSalesMayEdit(ctx, caseId);
      const removed = await verificationCaseAssetRepo.deletePrincipal(ctx, caseId, principalId);
      if (!removed) throw new NotFoundError('Principal not found');
      return refreshGate(ctx, caseId, { actor: zohoFromCtx(ctx) });
    });
  },

  /**
   * Explicit submit. Re-evaluates and REFUSES if incomplete, naming what is outstanding — the agent
   * gets the list, not a generic rejection.
   */
  async submit(ctx: TenantContext, caseId: string): Promise<ApplicationDetail> {
    return withFlowSchemaGuard(async () => {
      await this.assertSalesMayEdit(ctx, caseId);
      const actor = zohoFromCtx(ctx);
      const detail = await refreshGate(ctx, caseId, {
        submitting: true,
        actor,
        actorName: ctx.userId,
      });
      if (!detail.intake.complete) {
        throw new AppError(
          `This application is missing ${detail.intake.missing.length} item(s): ${detail.intake.missing
            .map((m) => m.label)
            .join(', ')}.`,
          { statusCode: 422, code: 'VERIFICATION_INTAKE_INCOMPLETE', expose: true },
        );
      }

      // A company with no MC/DOT goes straight to a human, per the SOP, rather than down a flow
      // with two phases it can never clear.
      if (requiresManagerReviewAtIntake(detail.case)) {
        const updated = await verificationFlowRepo.applyTransition(ctx, caseId, {
          phaseCode: 'p1_intake',
          statusCode: VERIFICATION_STATUS.managerReview,
          phaseStatus: 'manager_review',
          decidedPhase: 'p1_intake',
          outcome: 'manager_review',
          closed: false,
          eventType: 'phase_decision',
          eventNotes: 'LLC / corporation without MC/DOT — routed to Manager Review at intake.',
          actorZohoUserId: actor,
        });
        if (updated) return { ...detail, case: updated };
      }
      return detail;
    });
  },

  async listForAgent(
    ctx: TenantContext,
    filter: {
      limit?: number | undefined;
      offset?: number | undefined;
      statusCode?: string | undefined;
      gate?: boolean | undefined;
    },
  ) {
    return withFlowSchemaGuard(async () => {
      const self = zohoFromCtx(ctx) ?? ctx.userId;
      const [items, total, statuses] = await Promise.all([
        verificationFlowRepo.listForSalesAgent(ctx, self, filter),
        verificationFlowRepo.countForSalesAgent(ctx, self, filter),
        verificationFlowRepo.listStatuses(),
      ]);
      const board = new Map(statuses.map((s) => [s.code, s]));
      return {
        items: items.map((row) => ({
          ...row,
          statusLabel: board.get(row.statusCode)?.label ?? row.statusCode,
          boardColumn: board.get(row.statusCode)?.boardColumn ?? null,
        })),
        total,
      };
    });
  },

  refreshGate,
};
