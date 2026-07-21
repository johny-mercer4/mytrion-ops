-- Sales Open Pool: claim requires deal-owner approve (or 1 BD auto-approve).
ALTER TABLE "retention_cases" ADD COLUMN IF NOT EXISTS "pool_owner_zoho_user_id" text;
ALTER TABLE "retention_cases" ADD COLUMN IF NOT EXISTS "pending_claimant_zoho_user_id" text;

INSERT INTO "retention_statuses" ("code", "phase_code", "label", "is_terminal") VALUES
  ('p1_pool_claim_pending', 'phase_1_agent', 'Open Pool — claim pending approval', false)
ON CONFLICT ("code") DO UPDATE SET
  "phase_code" = EXCLUDED."phase_code",
  "label" = EXCLUDED."label",
  "is_terminal" = EXCLUDED."is_terminal";
