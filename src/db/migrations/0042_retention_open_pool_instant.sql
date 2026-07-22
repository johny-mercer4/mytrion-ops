-- Instant Open Pool claims: audit outcome_note + expired status; activity index.
-- Backfill: return in-flight pending claims to Open Pool (reject request) so nothing
-- sits awaiting CS approve after deploy. Agents re-claim with the new instant path.

ALTER TABLE "retention_claim_requests" ADD COLUMN IF NOT EXISTS "outcome_note" text;

CREATE INDEX IF NOT EXISTS "retention_claim_requests_tenant_requested_at_idx"
  ON "retention_claim_requests" ("tenant_id", "requested_at");

-- Mark open claim requests as rejected (migrate away from approve queue).
UPDATE "retention_claim_requests"
SET
  "status" = 'rejected',
  "outcome_note" = COALESCE("outcome_note", 'migrate_instant_claim'),
  "resolved_at" = COALESCE("resolved_at", now())
WHERE "status" = 'requested';

-- Unlock Processing cases back to Open Pool with a fresh 3BD claim window.
UPDATE "retention_cases"
SET
  "status_code" = 'p1_open_pool',
  "pending_claimant_zoho_user_id" = NULL,
  "current_deadline_type" = '3BD_pool_claim',
  "current_deadline_at" = now() + interval '3 days',
  "updated_at" = now()
WHERE "status_code" = 'p1_pool_claim_pending'
  AND "closed_at" IS NULL;
