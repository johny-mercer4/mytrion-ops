-- Retention→Pool cycle counter + claim transfer audit (previous owner).

ALTER TABLE "retention_cases"
  ADD COLUMN IF NOT EXISTS "retention_to_pool_count" smallint DEFAULT 0 NOT NULL;

ALTER TABLE "retention_claim_requests"
  ADD COLUMN IF NOT EXISTS "previous_owner_zoho_user_id" text;

ALTER TABLE "retention_claim_requests"
  ADD COLUMN IF NOT EXISTS "previous_owner_name" text;
