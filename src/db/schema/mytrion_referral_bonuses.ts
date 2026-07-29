import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), so each schema file loads standalone under drizzle-kit.

/**
 * The four referral bonus logics (Referral_Bonus_Calculation_Types PDF). These map 1:1 onto the
 * `Calculation` picklist that exists on BOTH Zoho referral modules (Parent_Referrers and
 * Child_Referrals):
 *
 *   'Gallons (Legacy)' → gallons_legacy   'Swipes (Legacy)' → swipes_legacy
 *   'Gallons (Parent)' → gallons_parent   'Gallons (Child)' → gallons_child
 *
 * Zoho's picklist is single-select, so each configured relationship uses exactly one calculation
 * type at a time. The ledger remains keyed per (child, type, month), preserving history if an admin
 * later changes that configuration.
 */
export type ReferralBonusType =
  | 'gallons_legacy'
  | 'swipes_legacy'
  | 'gallons_parent'
  | 'gallons_child';

/**
 * Who the money goes to. Types 1-3 pay the Parent Referrer; type 4 is the documented exception and
 * pays the Child Referral itself. Stored per row so an export never has to re-derive it.
 */
export type ReferralBonusRecipient = 'parent' | 'child';

/**
 * How the child referral was resolved to a carrier (and therefore to DWH transactions).
 *
 * The required path is referral relationship → related Deal → `Deals.Carrier_ID` (an integer that
 * joins `octane.mart_transaction_line_items.carrier_id` natively). Referral-module Carrier_ID text
 * is intentionally not accepted as a fallback because it bypasses the auditable Deal relationship.
 */
export type ReferralBonusResolution = 'deal_lookup' | 'lead_lookup' | 'carrier_id' | 'unresolved';

/** Ledger row lifecycle. Recalculation may freely overwrite 'calculated'; never 'paid' or 'void'. */
export type ReferralBonusStatus = 'calculated' | 'approved' | 'paid' | 'void';

/** Calculation run lifecycle. */
export type ReferralCalcRunStatus = 'running' | 'succeeded' | 'failed';

/** Trigger source for a calculation run — the monthly job or a manual admin re-run. */
export type ReferralCalcRunTrigger = 'scheduled' | 'manual';

/**
 * mytrion_referral_bonuses — the computed referral bonus ledger.
 *
 * Zoho stays authoritative for CONFIGURATION (who referred whom, which `Calculation` applies); the
 * money is computed and stored here. Zoho cannot be the ledger: it carries only two booleans
 * (`Child_Referrals.Parent_Paid` / `.Paid`) and no per-month history at all.
 *
 * One row per (child referral, bonus type, period month). For the two one-time types
 * (gallons_parent / gallons_child) `periodMonth` is the month in which the cumulative gallon
 * threshold was first crossed.
 *
 * Duplicate-payout safety (the PDF's explicit "guard against duplicate payouts" requirement) is
 * enforced by TWO indexes, because one is not enough:
 *   1. `..._period_uq` — unique per (child, type, month). Makes a monthly recompute idempotent.
 *   2. `..._one_time_uq` — a PARTIAL unique on (child, type) restricted to the one-time types. This
 *      is the one that actually matters: without it, a recompute whose threshold-crossing month
 *      shifted (late-arriving transactions, a corrected fuel-code filter) would insert a SECOND
 *      one-time row under a different month and pay the $50 twice.
 *
 * Quantities are stored alongside the amount so an export is self-explaining and a payout can be
 * audited without re-running the DWH aggregation.
 */
export const mytrionReferralBonuses = pgTable(
  'mytrion_referral_bonuses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rb_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    bonusType: text('bonus_type').$type<ReferralBonusType>().notNull(),
    /**
     * First day of the calendar month the bonus belongs to. `date` (not timestamp) on purpose —
     * DWH `transaction_date` is `timestamp without time zone` and the whole stack reads its naive
     * parts (see dwhTransactions.ts naiveTimestamp, and servercrm's `transaction_date::date`).
     * A timestamptz here would drag every month boundary across a 5-hour offset.
     */
    periodMonth: date('period_month', { mode: 'string' }).notNull(),

    // --- Parties (Zoho record ids; kept as text since Zoho ids exceed JS safe-integer range) ---
    /** `Child_Referrals` record id — the referred company whose fuel volume drives the bonus. */
    childReferralId: text('child_referral_id').notNull(),
    /** `Parent_Referrers` record id. Null when the child has no parent lookup set in Zoho. */
    parentReferrerId: text('parent_referrer_id'),
    /** Name snapshots, so an exported ledger stays readable if a Zoho record is later renamed. */
    childName: text('child_name'),
    parentName: text('parent_name'),

    // --- Carrier / transaction linkage ---
    /** Resolved carrier — joins `octane.mart_transaction_line_items.carrier_id`. */
    carrierId: integer('carrier_id'),
    /** The related Deal used to resolve the carrier. */
    zohoDealId: text('zoho_deal_id'),
    resolution: text('resolution').$type<ReferralBonusResolution>().notNull(),

    // --- Payout ---
    recipientKind: text('recipient_kind').$type<ReferralBonusRecipient>().notNull(),
    /** Denormalized display name of whoever gets paid (parent or child, per recipientKind). */
    recipientName: text('recipient_name'),
    /** Eligible gallons for THIS month (gallon-based types). */
    qtyGallons: numeric('qty_gallons', { precision: 14, scale: 2 }),
    /** New cards ("swipes") counted for THIS month (swipes_legacy only). */
    qtyNewCards: integer('qty_new_cards'),
    /** Lifetime eligible gallons at computation time — the one-time types' threshold evidence. */
    cumulativeGallons: numeric('cumulative_gallons', { precision: 14, scale: 2 }),
    /** Rate applied: 0.0100 per gallon, or 50.0000 per swipe / per one-time award. */
    rate: numeric('rate', { precision: 10, scale: 4 }),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull().default('0'),

    status: text('status').$type<ReferralBonusStatus>().notNull().default('calculated'),
    /** The `mytrion_referral_calc_runs` row that last wrote this record. */
    calcRunId: text('calc_run_id'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Idempotent monthly recompute: one row per child per type per month. */
    periodUq: uniqueIndex('mytrion_referral_bonuses_period_uq').on(
      table.tenantId,
      table.childReferralId,
      table.bonusType,
      table.periodMonth,
    ),
    /** The real one-time guard — a one-time bonus can exist at most once, in ANY month. */
    oneTimeUq: uniqueIndex('mytrion_referral_bonuses_one_time_uq')
      .on(table.tenantId, table.childReferralId, table.bonusType)
      .where(sql`${table.bonusType} in ('gallons_parent', 'gallons_child')`),
    /**
     * Economic duplicate guard. Zoho can hold several Child_Referral records for one carrier, but a
     * one-time company threshold may pay only once for that carrier.
     */
    oneTimeCarrierUq: uniqueIndex('mytrion_referral_bonuses_one_time_carrier_uq')
      .on(table.tenantId, table.carrierId, table.bonusType)
      .where(
        sql`${table.bonusType} in ('gallons_parent', 'gallons_child') and ${table.carrierId} is not null`,
      ),
    /** The Manager card's primary listing: a month, optionally narrowed to one type. */
    periodIdx: index('mytrion_referral_bonuses_tenant_period_idx').on(
      table.tenantId,
      table.periodMonth,
      table.bonusType,
    ),
    /** "What does this parent get paid?" — the payout roll-up. */
    parentIdx: index('mytrion_referral_bonuses_tenant_parent_idx').on(
      table.tenantId,
      table.parentReferrerId,
      table.periodMonth,
    ),
    /** Per-child history across every type. */
    childIdx: index('mytrion_referral_bonuses_tenant_child_idx').on(
      table.tenantId,
      table.childReferralId,
      table.periodMonth,
    ),
    /** Approval queue + the unresolved-linkage worklist. */
    statusIdx: index('mytrion_referral_bonuses_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.resolution,
    ),
  }),
);

/**
 * mytrion_referral_calc_runs — one row per calculation run, for audit (CLAUDE.md rule 8) and for
 * showing "last calculated" in the Manager card. `unresolvedCount` is deliberately first-class:
 * it exposes how many referral relationships still lack an unambiguous Deal and Carrier_ID.
 */
export const mytrionReferralCalcRuns = pgTable(
  'mytrion_referral_calc_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rbr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Month calculated (first of month). Null for a full-history backfill run. */
    periodMonth: date('period_month', { mode: 'string' }),
    status: text('status').$type<ReferralCalcRunStatus>().notNull().default('running'),
    trigger: text('trigger').$type<ReferralCalcRunTrigger>().notNull().default('manual'),
    /** Zoho user id of the admin who ran it, or 'system' for the scheduled run. */
    triggeredBy: text('triggered_by'),
    rowsWritten: integer('rows_written').notNull().default(0),
    amountTotalUsd: numeric('amount_total_usd', { precision: 14, scale: 2 }).notNull().default('0'),
    unresolvedCount: integer('unresolved_count').notNull().default(0),
    /** Failure detail when status = 'failed'. */
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    tenantPeriodIdx: index('mytrion_referral_calc_runs_tenant_period_idx').on(
      table.tenantId,
      table.periodMonth,
      table.startedAt,
    ),
  }),
);

export type MytrionReferralBonus = typeof mytrionReferralBonuses.$inferSelect;
export type NewMytrionReferralBonus = typeof mytrionReferralBonuses.$inferInsert;
export type MytrionReferralCalcRun = typeof mytrionReferralCalcRuns.$inferSelect;
export type NewMytrionReferralCalcRun = typeof mytrionReferralCalcRuns.$inferInsert;
