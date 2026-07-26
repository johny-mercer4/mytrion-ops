-- Manager Mytrion → Referral bonuses: the computed bonus ledger + calculation run audit.
--
-- Zoho stays authoritative for CONFIGURATION (Parent_Referrers / Child_Referrals, and the
-- `Calculation` picklist that selects which logic applies). The money is computed and stored here,
-- because Zoho carries only two booleans (Child_Referrals.Parent_Paid / .Paid) and no per-month
-- history at all.
--
-- One row per (child referral, bonus type, period month). Types 1 and 2 are concurrent monthly
-- payouts per the calculation-types PDF, so a single child can hold several types in one month.

CREATE TABLE IF NOT EXISTS "mytrion_referral_bonuses" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  -- 'gallons_legacy' | 'swipes_legacy' | 'gallons_parent' | 'gallons_child'
  "bonus_type" text NOT NULL,
  -- First day of the calendar month. `date`, not timestamptz: DWH transaction_date is
  -- `timestamp without time zone` and the stack reads its naive parts, so a zoned column here
  -- would drag every month boundary across a 5-hour offset.
  "period_month" date NOT NULL,
  "child_referral_id" text NOT NULL,
  "parent_referrer_id" text,
  "child_name" text,
  "parent_name" text,
  -- Resolved carrier — joins octane.mart_transaction_line_items.carrier_id.
  "carrier_id" integer,
  "zoho_deal_id" text,
  -- 'deal_lookup' | 'lead_lookup' | 'carrier_id' | 'unresolved'
  "resolution" text NOT NULL,
  -- 'parent' | 'child' — type 4 is the documented exception that pays the child.
  "recipient_kind" text NOT NULL,
  "recipient_name" text,
  "qty_gallons" numeric(14, 2),
  "qty_new_cards" integer,
  "cumulative_gallons" numeric(14, 2),
  "rate" numeric(10, 4),
  "amount_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
  -- 'calculated' | 'approved' | 'paid' | 'void'
  "status" text DEFAULT 'calculated' NOT NULL,
  "calc_run_id" text,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Idempotent monthly recompute: one row per child per type per month.
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_referral_bonuses_period_uq"
  ON "mytrion_referral_bonuses" ("tenant_id", "child_referral_id", "bonus_type", "period_month");
--> statement-breakpoint
-- The real duplicate-payout guard the PDF requires. The period-scoped unique above is NOT enough:
-- if a recompute moved the threshold-crossing month (late transactions, corrected fuel filter) it
-- would insert a SECOND one-time row under a different month and pay the $50 twice.
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_referral_bonuses_one_time_uq"
  ON "mytrion_referral_bonuses" ("tenant_id", "child_referral_id", "bonus_type")
  WHERE "bonus_type" IN ('gallons_parent', 'gallons_child');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_referral_bonuses_tenant_period_idx"
  ON "mytrion_referral_bonuses" ("tenant_id", "period_month", "bonus_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_referral_bonuses_tenant_parent_idx"
  ON "mytrion_referral_bonuses" ("tenant_id", "parent_referrer_id", "period_month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_referral_bonuses_tenant_child_idx"
  ON "mytrion_referral_bonuses" ("tenant_id", "child_referral_id", "period_month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_referral_bonuses_tenant_status_idx"
  ON "mytrion_referral_bonuses" ("tenant_id", "status", "resolution");
--> statement-breakpoint
-- One row per calculation run, for audit (CLAUDE.md rule 8) and the card's "last calculated".
-- `unresolved_count` is first-class: while the Zoho Deal/Lead Child_Referrer lookups stay empty it
-- is the number that says how much of the ledger ran on the carrier-id fallback.
CREATE TABLE IF NOT EXISTS "mytrion_referral_calc_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  -- Null for a full-history backfill run.
  "period_month" date,
  -- 'running' | 'succeeded' | 'failed'
  "status" text DEFAULT 'running' NOT NULL,
  -- 'scheduled' | 'manual'
  "trigger" text DEFAULT 'manual' NOT NULL,
  "triggered_by" text,
  "rows_written" integer DEFAULT 0 NOT NULL,
  "amount_total_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
  "unresolved_count" integer DEFAULT 0 NOT NULL,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_referral_calc_runs_tenant_period_idx"
  ON "mytrion_referral_calc_runs" ("tenant_id", "period_month", "started_at");
