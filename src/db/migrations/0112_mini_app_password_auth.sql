-- Mini-app password auth: revive carrier_users for invite→password login, and a
-- forget-password queue that Sales resolves from Manage.
-- Idempotent: safe on fresh and existing DBs.

ALTER TABLE "carrier_users" ADD COLUMN IF NOT EXISTS "registration_id" text;
ALTER TABLE "carrier_users" ADD COLUMN IF NOT EXISTS "telegram_user_id" text;

CREATE INDEX IF NOT EXISTS "carrier_users_tenant_registration_idx"
  ON "carrier_users" ("tenant_id", "registration_id");

-- Non-null telegram ids unique per tenant; multiple legacy NULLs stay allowed.
CREATE UNIQUE INDEX IF NOT EXISTS "carrier_users_tenant_telegram_uk"
  ON "carrier_users" ("tenant_id", "telegram_user_id")
  WHERE "telegram_user_id" IS NOT NULL;

ALTER TABLE "carrier_invitations" ADD COLUMN IF NOT EXISTS "auth_mode" text DEFAULT 'password' NOT NULL;
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "auth_mode" text DEFAULT 'telegram' NOT NULL;

CREATE TABLE IF NOT EXISTS "mini_app_password_resets" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "carrier_user_id" text NOT NULL,
  "registration_id" text,
  "carrier_id" text,
  "company_name" text,
  "login" text NOT NULL,
  "profile" text NOT NULL,
  "agent_zoho_user_id" text,
  "agent_name" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "note" text,
  "resolved_by_zoho_user_id" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "mini_app_password_resets_tenant_status_idx"
  ON "mini_app_password_resets" ("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "mini_app_password_resets_agent_idx"
  ON "mini_app_password_resets" ("tenant_id", "agent_zoho_user_id", "status");
CREATE INDEX IF NOT EXISTS "mini_app_password_resets_carrier_idx"
  ON "mini_app_password_resets" ("tenant_id", "carrier_id");
