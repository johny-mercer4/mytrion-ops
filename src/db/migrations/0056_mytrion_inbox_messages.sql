-- Mytrion Inbox Messages — our own copy of the Zoho CRM "Inbox" module (Org_Module).
-- Replaces reading the inbox live from Zoho + the servercrm crm_inbox_notification WebSocket:
-- rows are created via our webhook/repo and pushed live over /v1/realtime (inbox:worker:<zohoId>).

CREATE TABLE IF NOT EXISTS "mytrion_inbox_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "zoho_record_id" text,
  "owner_zoho_user_id" text NOT NULL,
  "owner_name" text,
  "owner_email" text,
  "subject" text NOT NULL,
  "name" text,
  "content" text,
  "type" text DEFAULT 'Info' NOT NULL,
  "priority" text DEFAULT 'medium' NOT NULL,
  "tag" text,
  "source_url" text,
  "record_status" text DEFAULT 'Available' NOT NULL,
  "zoho_created_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_inbox_messages_tenant_owner_idx"
  ON "mytrion_inbox_messages" ("tenant_id", "owner_zoho_user_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_inbox_messages_tenant_zoho_uk"
  ON "mytrion_inbox_messages" ("tenant_id", "zoho_record_id")
  WHERE "zoho_record_id" IS NOT NULL;
