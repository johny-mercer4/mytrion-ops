-- Billing Ledger core (TZ §5, §8, §10.2) — three tables:
--   ledger_opening_balances       append-only inception anchors, one LIVE row per (carrier, section)
--   ledger_client_type_overrides  effective-dated LOC/Prepay corrections over DWH payment_terms
--   ledger_import_batches         bulk opening-balance spreadsheet journal (preview → commit → revert)
--
-- HAND-WRITTEN and idempotent, matching 0101/0102. `db:generate` cannot be used here: the snapshot in
-- meta/ is stale against several teams' schema files, so it emits their pending drift (mytrion_thread_*,
-- mytrion_tickets, mytrion_escalations, a file_assets column, …) mixed into whatever you added. See the
-- note in drizzle.config.ts. Statements below are IF NOT EXISTS so a fresh DB and prod both converge.
--
-- None of the three are tenant-scoped: they are keyed on the CMP carrier_id domain, matching
-- payment_transactions / maintenance_cases / money_code_requests. The isolation boundary is the billing
-- department gate, not tenancy. See each schema file's header.

CREATE TABLE IF NOT EXISTS "ledger_opening_balances" (
  "id" text PRIMARY KEY NOT NULL,
  "carrier_id" text NOT NULL,
  "section" text NOT NULL,
  "as_of_date" date NOT NULL,
  "amount" numeric(14, 2) NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "source" text NOT NULL,
  "import_batch_id" text,
  "note" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "supersedes_id" text,
  "superseded_at" timestamp with time zone,
  "superseded_by_name" text,
  "created_by_user_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ledger_opening_balances_section_check"
    CHECK ("section" IN ('cb-loc', 'unbilled', 'ar', 'cb-prepay', 'untopped')),
  CONSTRAINT "ledger_opening_balances_source_check"
    CHECK ("source" IN ('excel', 'manual', 'migration')),
  CONSTRAINT "ledger_opening_balances_revision_check"
    CHECK ("revision" >= 1)
);

-- Exactly one LIVE opening balance per carrier per section. NOT keyed on as_of_date on purpose: the
-- opening balance is a single inception anchor, not a time series — two live as-of dates would mean two
-- competing since-inception baselines. Correcting the date is a new revision.
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_opening_balances_live_uk"
  ON "ledger_opening_balances" ("carrier_id", "section")
  WHERE "superseded_at" IS NULL;

CREATE INDEX IF NOT EXISTS "ledger_opening_balances_carrier_section_idx"
  ON "ledger_opening_balances" ("carrier_id", "section");

-- "Which carriers still lack an opening balance" — the launch-migration progress bar.
CREATE INDEX IF NOT EXISTS "ledger_opening_balances_section_live_idx"
  ON "ledger_opening_balances" ("section", "superseded_at");

CREATE INDEX IF NOT EXISTS "ledger_opening_balances_batch_idx"
  ON "ledger_opening_balances" ("import_batch_id")
  WHERE "import_batch_id" IS NOT NULL;


CREATE TABLE IF NOT EXISTS "ledger_client_type_overrides" (
  "id" text PRIMARY KEY NOT NULL,
  "carrier_id" text NOT NULL,
  "client_type" text NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "reason" text NOT NULL,
  "dwh_value_at_write" text,
  "created_by_user_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "closed_by_name" text,
  CONSTRAINT "ledger_client_type_overrides_type_check"
    CHECK ("client_type" IN ('LOC', 'Prepay'))
);

-- At most one OPEN override per carrier (the kpi_worker_memberships_open_uk pattern).
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_client_type_overrides_open_uk"
  ON "ledger_client_type_overrides" ("carrier_id")
  WHERE "effective_to" IS NULL;

CREATE INDEX IF NOT EXISTS "ledger_client_type_overrides_carrier_from_idx"
  ON "ledger_client_type_overrides" ("carrier_id", "effective_from");


CREATE TABLE IF NOT EXISTS "ledger_import_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "file_name" text NOT NULL,
  "file_bytes" integer NOT NULL,
  "file_sha256" text NOT NULL,
  "template_version" text,
  "row_count" integer DEFAULT 0 NOT NULL,
  "accepted_count" integer DEFAULT 0 NOT NULL,
  "rejected_count" integer DEFAULT 0 NOT NULL,
  "changed_count" integer DEFAULT 0 NOT NULL,
  "new_count" integer DEFAULT 0 NOT NULL,
  "unchanged_count" integer DEFAULT 0 NOT NULL,
  "validation" jsonb,
  "file_errors" jsonb,
  "uploaded_by_user_id" text,
  "uploaded_by_name" text,
  "uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "committed_at" timestamp with time zone,
  "committed_by_name" text,
  "reverted_at" timestamp with time zone,
  "reverted_by_name" text,
  CONSTRAINT "ledger_import_batches_status_check"
    CHECK ("status" IN ('pending', 'committed', 'discarded', 'reverted'))
);

-- Re-uploading identical bytes resumes the live pending batch instead of forking a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_import_batches_pending_sha_uk"
  ON "ledger_import_batches" ("file_sha256")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "ledger_import_batches_status_uploaded_idx"
  ON "ledger_import_batches" ("status", "uploaded_at");
