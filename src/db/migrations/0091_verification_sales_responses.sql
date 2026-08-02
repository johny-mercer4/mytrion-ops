CREATE TABLE IF NOT EXISTS "verification_sales_responses" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "request_id" text NOT NULL,
  "deal_id" text NOT NULL,
  "external_event_id" text NOT NULL,
  "owner_zoho_user_id" text NOT NULL,
  "response_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "note" text,
  "attachment_name" text,
  "attachment_content_type" text,
  "attachment_size_bytes" integer,
  "zoho_note_id" text,
  "sync_warning" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verification_sales_responses_tenant_event_uq"
  ON "verification_sales_responses" ("tenant_id", "request_id", "external_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_sales_responses_tenant_request_idx"
  ON "verification_sales_responses" ("tenant_id", "request_id", "created_at");
