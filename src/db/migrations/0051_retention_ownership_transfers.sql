-- Durable Zoho ownership transfer log (survives retention_cases hard-delete).

CREATE TABLE IF NOT EXISTS "retention_ownership_transfers" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "retention_case_id" bigint,
  "carrier_id" text,
  "company_name" text,
  "zoho_deal_id" text,
  "zoho_contact_id" text,
  "zoho_account_id" text,
  "reason" text NOT NULL,
  "result" text NOT NULL,
  "from_owner_zoho_user_id" text,
  "from_owner_name" text,
  "to_owner_zoho_user_id" text NOT NULL,
  "to_owner_name" text,
  "actor_zoho_user_id" text,
  "actor_name" text,
  "deal_updated" boolean DEFAULT false NOT NULL,
  "contact_updated" boolean DEFAULT false NOT NULL,
  "account_updated" boolean DEFAULT false NOT NULL,
  "warnings" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_ownership_transfers_tenant_created_idx"
  ON "retention_ownership_transfers" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_ownership_transfers_deal_idx"
  ON "retention_ownership_transfers" ("zoho_deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_ownership_transfers_case_idx"
  ON "retention_ownership_transfers" ("retention_case_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_ownership_transfers_carrier_idx"
  ON "retention_ownership_transfers" ("carrier_id");
