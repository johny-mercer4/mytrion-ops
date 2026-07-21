-- Align money_code_requests with the ServerCRM draw model (same Ops DB table).
-- Idempotent: ADD COLUMN IF NOT EXISTS / DROP unique arbiter / create indexes.

ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "invoice_limit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "efs_id" text;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "company_name" text;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "batch_id" bigint;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "requested_dow" text;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "requested_ny_date" date;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "moneycode_reason" text;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "unit_number" text;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "notify_error" text;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "used_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN IF NOT EXISTS "used_count" integer;--> statement-breakpoint

-- valid_until is issue+72h (instant), not a cycle date.
ALTER TABLE "money_code_requests"
  ALTER COLUMN "valid_until" TYPE timestamp with time zone
  USING "valid_until"::timestamp with time zone;--> statement-breakpoint

-- Draw model: many ISSUED rows per invoice — drop the old ACTIVE unique arbiter.
DO $$
DECLARE idx text;
BEGIN
  FOR idx IN
    SELECT indexname FROM pg_indexes
     WHERE tablename = 'money_code_requests'
       AND indexdef ILIKE '%UNIQUE%(carrier_id, invoice_id)%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx);
  END LOOP;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_money_code_active_by_invoice"
  ON "money_code_requests" ("carrier_id", "invoice_id")
  WHERE "status" <> 'VOIDED';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_money_code_status_created"
  ON "money_code_requests" ("status", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_money_code_batch"
  ON "money_code_requests" ("batch_id")
  WHERE "batch_id" IS NOT NULL;
