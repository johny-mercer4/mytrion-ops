CREATE TABLE IF NOT EXISTS "sales_agent_mini_app_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "zoho_user_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "requested_carrier_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "redeemed_telegram_user_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_agent_mini_app_invites_agent_idx"
  ON "sales_agent_mini_app_invitations" USING btree ("tenant_id", "zoho_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_agent_mini_app_principals" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "zoho_user_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "telegram_username" text,
  "language_code" text,
  "status" text DEFAULT 'active' NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_mini_app_principals_tenant_zoho_uk"
  ON "sales_agent_mini_app_principals" USING btree ("tenant_id", "zoho_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_mini_app_principals_tenant_tg_uk"
  ON "sales_agent_mini_app_principals" USING btree ("tenant_id", "telegram_user_id");
