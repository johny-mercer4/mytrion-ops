-- Billing Ledger daily snapshots (TZ §9 — the daily Closing recompute + external reconciliation).
--
-- DERIVED and UPSERTED, unlike ledger_opening_balances (append-only): the source of truth is the
-- opening balances plus the external feeds, and recomputing a past day legitimately changes it — a CMP
-- payment reversal deletes the payment row, so yesterday's AR credit really is different today.
--
-- `opening`/`closing` stay NULL when the carrier has no opening balance, and `status = 'no_opening'`
-- keeps that case measurable and separate from a real variance.
--
-- Hand-written and idempotent, matching 0101–0103. See the note in drizzle.config.ts for why
-- `db:generate` cannot be used in this repo.

CREATE TABLE IF NOT EXISTS "ledger_daily_snapshots" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "as_of_date" date NOT NULL,
  "carrier_id" text NOT NULL,
  "section" text NOT NULL,
  "client_type" text NOT NULL,
  "opening" numeric(14, 2),
  "debit" numeric(14, 2) DEFAULT '0' NOT NULL,
  "credit" numeric(14, 2) DEFAULT '0' NOT NULL,
  "closing" numeric(14, 2),
  "external_value" numeric(14, 2),
  "external_source" text,
  "variance" numeric(14, 2),
  "status" text NOT NULL,
  "detail" jsonb,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ledger_daily_snapshots_section_check"
    CHECK ("section" IN ('cb-loc', 'unbilled', 'ar', 'cb-prepay', 'untopped')),
  CONSTRAINT "ledger_daily_snapshots_status_check"
    CHECK ("status" IN ('ok', 'variance', 'no_opening', 'source_unavailable', 'stale_external'))
);

-- The upsert key.
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_daily_snapshots_day_uk"
  ON "ledger_daily_snapshots" ("as_of_date", "carrier_id", "section");

-- The control-point queues ("today's AR variances").
CREATE INDEX IF NOT EXISTS "ledger_daily_snapshots_queue_idx"
  ON "ledger_daily_snapshots" ("as_of_date", "section", "status");

-- Per-carrier history, and the (period start − 1 day) opening lookup.
CREATE INDEX IF NOT EXISTS "ledger_daily_snapshots_carrier_idx"
  ON "ledger_daily_snapshots" ("carrier_id", "section", "as_of_date" DESC);
