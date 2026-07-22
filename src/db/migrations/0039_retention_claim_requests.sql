CREATE TABLE IF NOT EXISTS "retention_claim_requests" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "retention_case_id" bigint NOT NULL REFERENCES "retention_cases"("id") ON DELETE CASCADE,
  "carrier_id" text NOT NULL,
  "zoho_deal_id" text,
  "requester_zoho_user_id" text NOT NULL,
  "requester_name" text,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'requested',
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz,
  "resolved_by_zoho_user_id" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_claim_requests_tenant_status_idx"
  ON "retention_claim_requests" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_claim_requests_case_idx"
  ON "retention_claim_requests" ("retention_case_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retention_claim_requests_one_open_per_case"
  ON "retention_claim_requests" ("retention_case_id")
  WHERE "status" = 'requested';
