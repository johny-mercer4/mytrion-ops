-- Enrich ownership transfer log with deal/contact display names (from→to clarity).

ALTER TABLE "retention_ownership_transfers"
  ADD COLUMN IF NOT EXISTS "deal_name" text;
--> statement-breakpoint
ALTER TABLE "retention_ownership_transfers"
  ADD COLUMN IF NOT EXISTS "contact_name" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_ownership_transfers_from_owner_idx"
  ON "retention_ownership_transfers" ("from_owner_zoho_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_ownership_transfers_to_owner_idx"
  ON "retention_ownership_transfers" ("to_owner_zoho_user_id");
