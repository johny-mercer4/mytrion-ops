-- maintenance_cases — Octane's maintenance case queue, replacing the Zoho CRM `Maintenance` module.
--
-- Postgres is the source of truth. Zoho's existing records are migrated ONCE
-- (scripts/migrateMaintenanceFromZoho.ts, 2,714 rows as of 2026-07-30) and Zoho is not read again;
-- the CS Mytrion Maintenance tab creates and edits cases here. See docs/crm-maintenance-module.md
-- for the field reference this table mirrors, and src/db/schema/maintenance_cases.ts for the
-- per-column rationale.
--
-- Hand-written rather than drizzle-kit generated: `generate` has been unusable in this repo since
-- 0024 (68 journal entries, 25 snapshots — it aborts on a 0022/0023 parent-snapshot collision), so
-- every migration from 0025 on is hand-authored. Kept fully idempotent with IF NOT EXISTS so a
-- hand-edited baseline applies cleanly to both a fresh and an existing database.
--
-- NUMBERED 0079 — the FOURTH number this file has carried (0068 → 0070 → 0076 → 0079). Because the
-- journal is hand-maintained, the next free number is NOT "one past the highest file on build", and
-- the `when` stamp is NOT free-choice. Both bite, and both bit here:
--   * NUMBER. 0068-0075 were taken by `main` (six commits ahead of `build`), then `main` advanced
--     again and took 0076/0077 for support-bot work, and 0078 is claimed by 0078_support_bot_memories
--     on a still-unmerged branch. So: check EVERY remote branch, not `origin/build`, not just `main`.
--   * STAMP. Drizzle's migrator applies an entry only when `lastAppliedOnThisDb.created_at <
--     entry.when`, and it reads that ceiling ONCE before the loop. An entry at or below it is
--     silently SKIPPED — no error, no table.
--
-- That skip is not hypothetical. This file was first stamped 1785394800000, which is the SAME
-- millisecond `main` stamped 0076_support_bot_operations. This one reached prod first, so main's was
-- skipped and `support_bot_operations` / `support_bot_session_fences` were missing from prod while the
-- journal claimed otherwise. 0081_support_bot_operations_repair repairs that.
--
-- Hence `when` here is 1785398400001 — exactly 1 ms past prod's ceiling, NOT the next hour slot. The
-- hour slots are the repo convention but 1785402000000 already belongs to 0078_support_bot_memories;
-- stamping above it would push THAT migration below the deployed ceiling and skip it in turn.
-- Re-running this file is harmless (every statement is IF NOT EXISTS), so re-stamping it above the
-- ceiling costs nothing and lets any database that missed it self-heal.
--
-- Before adding a migration here: check every remote branch for the next free number, read the target
-- DB's `max(created_at)` from drizzle.__drizzle_migrations, and stamp just above it.

CREATE TABLE IF NOT EXISTS "maintenance_cases" (
  "id" text PRIMARY KEY NOT NULL,

  -- Provenance. zoho_record_id is NULL for cases created in Mytrion.
  "zoho_record_id" text,
  "source" text DEFAULT 'mytrion' NOT NULL,

  -- Identity + the three search keys. carrier_id and unit_number are TEXT: Zoho stores the carrier
  -- id as text, and unit numbers arrive zero-padded ('012'), which an integer column would destroy.
  "name" text,
  "company_zoho_id" text,
  "company_name" text,
  "carrier_id" text,
  "unit_number" text,

  -- Case. case_date renames Zoho's `Date` — `date` is a poor column name and `Date` is a
  -- COQL-touchy identifier.
  "status" text,
  "case_type" text,
  "case_date" date,
  "case_completion" date,
  "driver_name" text,
  "phone" text,
  "shop_number" text,
  "parts" text,
  "work_order_id" text,
  -- Identifier, never arithmetic — TEXT even though Zoho types it as an integer.
  "reference_number" text,

  -- Payment. Only payment_method = 'Prepay / EFS' is what servercrm's prepay ledger counts.
  "payment_method" text,
  "payment_status" text,
  "invoiced" boolean,
  -- TEXT to preserve leading zeros.
  "card_digits" text,

  -- Money.
  "total_amount" numeric(14, 2),
  "completion_compensation" numeric(14, 2),
  "half_completion_compensation" numeric(14, 2),
  "lead_compensation" numeric(14, 2),

  -- Ownership. owner_name holds the FULL name; Zoho's COQL returns only the last name, so the
  -- migration resolves it through the user directory before writing.
  "owner_zoho_user_id" text,
  "owner_name" text,
  "bonus_completion_user_id" text,
  "bonus_completion_name" text,
  "bonus_lead_user_id" text,
  "bonus_lead_name" text,

  -- Zoho stamps, kept distinct from our own created_at/updated_at.
  "created_time" timestamp with time zone,
  "modified_time" timestamp with time zone,

  -- Our bookkeeping. created_by_*/updated_by_* are the Mytrion session user and are deliberately
  -- excluded from the migration upsert's conflict SET — a re-run must never clobber an agent's edit.
  "raw" jsonb,
  "created_by_user_id" text,
  "created_by_name" text,
  "updated_by_user_id" text,
  "updated_by_name" text,
  "synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Migration upsert key. PARTIAL on purpose: every Mytrion-created row has a NULL zoho_record_id and
-- a plain unique index would collide on the second one.
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_cases_zoho_uk"
  ON "maintenance_cases" ("zoho_record_id") WHERE "zoho_record_id" IS NOT NULL;
--> statement-breakpoint

-- Default list order, closed with `id` so the sort is total — an offset page cannot skip or
-- duplicate a row when many cases share a date.
CREATE INDEX IF NOT EXISTS "maintenance_cases_case_date_idx"
  ON "maintenance_cases" ("case_date","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_cases_status_idx"
  ON "maintenance_cases" ("status","case_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_cases_case_type_idx"
  ON "maintenance_cases" ("case_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_cases_carrier_idx"
  ON "maintenance_cases" ("carrier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_cases_owner_idx"
  ON "maintenance_cases" ("owner_zoho_user_id","case_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_cases_payment_idx"
  ON "maintenance_cases" ("payment_method","payment_status");
--> statement-breakpoint

-- Search-path indexes for the tab's one search box (carrier ID / company / unit #).
--
-- text_pattern_ops serves the prefix matches an agent actually types; no pg_trgm here, because the
-- extension is not installed in this database (only `vector` is) and 2,714 narrow rows do not
-- justify requesting it. Revisit above ~50k rows or if p95 search exceeds ~150 ms.
CREATE INDEX IF NOT EXISTS "maintenance_cases_carrier_prefix_idx"
  ON "maintenance_cases" ("carrier_id" text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_cases_company_lower_idx"
  ON "maintenance_cases" (lower("company_name") text_pattern_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "maintenance_cases_name_lower_idx"
  ON "maintenance_cases" (lower("name") text_pattern_ops);
--> statement-breakpoint

-- Unit numbers arrive as '012', '#123', 'T-123'. The repo's search predicate normalizes with the
-- IDENTICAL expression — if the two ever drift, this index silently stops being used.
CREATE INDEX IF NOT EXISTS "maintenance_cases_unit_norm_idx"
  ON "maintenance_cases" (lower(regexp_replace("unit_number", '[^a-zA-Z0-9]', '', 'g')));
