-- Stage-0 routing: give a verification case its OWN assignee, and record who it went to.
--
-- HAND-WRITTEN, not generated. No verification schema file is registered in `drizzle.config.ts` (see
-- the NOTE there), so `pnpm db:generate` cannot see these tables — and pointing it at them would emit
-- every other team's pending drift alongside this change. Idempotent throughout, so it is safe on a
-- fresh database and on prod.
--
-- WHY THE NEW COLUMNS EXIST AT ALL. `verification_cases.owner_zoho_user_id` is the SALES assignee and
-- is read as one: `verificationFlowRepo.salesOwnership` ORs it into the Sales list scope, and
-- `applicationService.assertSalesMayEdit` ORs it into the Sales WRITE gate. The Zoho Deal poller used
-- it as a dumping ground whenever a Deal arrived with no owner, filling it with the configured CREDIT
-- AGENT — which put those cases in that credit agent's Sales Verification tab and gave them intake
-- edit rights on applications they do not own. Stage-0 round-robin assigns every case, so it would
-- have turned a handful of stale rows into all of them.

ALTER TABLE "verification_cases"
  ADD COLUMN IF NOT EXISTS "verification_owner_zoho_user_id" text,
  ADD COLUMN IF NOT EXISTS "verification_owner_name" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "verification_cases_tenant_verification_owner_idx"
  ON "verification_cases" ("tenant_id", "verification_owner_zoho_user_id");
--> statement-breakpoint

-- The history. Append-only; `verification_cases.verification_owner_*` is the current row's answer,
-- denormalised so a 200-row queue needs no correlated subquery. This is where fairness comes from:
-- Stage-0 picks the credit agent assigned LEAST RECENTLY, which is `max(assigned_at)` per agent, and
-- that survives a reassignment where a column on the case would not.
CREATE TABLE IF NOT EXISTS "verification_case_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "case_id" text NOT NULL,
  "zoho_user_id" text NOT NULL,
  "assignee_name" text,
  "previous_zoho_user_id" text,
  "reason" text DEFAULT 'stage0_round_robin' NOT NULL,
  "assigned_by_zoho_user_id" text,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "verification_case_assignments_tenant_agent_idx"
  ON "verification_case_assignments" ("tenant_id", "zoho_user_id", "assigned_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "verification_case_assignments_tenant_case_idx"
  ON "verification_case_assignments" ("tenant_id", "case_id", "assigned_at");
--> statement-breakpoint

-- BACKFILL the rows the old fallback mislabelled, and only those.
--
-- The signature is exact rather than guessed: a poller-created case (`origin = 'zoho_deal'`) whose
-- Deal has NO owner in Zoho (`zoho_owner_id IS NULL`) but which nonetheless carries a Sales assignee.
-- `createApplicationFromDeal` is the only writer that can produce that combination, and the only
-- value it puts there is the configured credit agent. Nothing here needs to know WHICH agent that is.
--
-- The assignee moves to the verification columns; the Sales pair is emptied so the case stops
-- appearing in a credit agent's Sales tab. `owner_zoho_user_id` / `owner_name` are NOT NULL, so they
-- are emptied to '' rather than dropped — `salesOwnerName` already reads a blank as "no Sales owner",
-- which is the honest answer for a Deal nobody owns.
UPDATE "verification_cases"
SET "verification_owner_zoho_user_id" = "owner_zoho_user_id",
    "verification_owner_name" = "owner_name",
    "owner_zoho_user_id" = '',
    "owner_name" = ''
WHERE "origin" = 'zoho_deal'
  AND "zoho_owner_id" IS NULL
  AND "owner_zoho_user_id" <> ''
  AND "verification_owner_zoho_user_id" IS NULL;
--> statement-breakpoint

-- Seed the history for what the backfill just claimed, so the round-robin's very first pick is fair
-- rather than treating every agent as never-assigned. `created_at` of the case is when the assignment
-- really happened.
INSERT INTO "verification_case_assignments"
  ("id", "tenant_id", "case_id", "zoho_user_id", "assignee_name", "reason", "assigned_at")
SELECT 'vca_bf_' || "id",
       "tenant_id",
       "id",
       "verification_owner_zoho_user_id",
       "verification_owner_name",
       'ingest_fallback_backfill',
       "created_at"
FROM "verification_cases"
WHERE "verification_owner_zoho_user_id" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
