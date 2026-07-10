-- Idempotent bootstrap for the carrier onboarding schema (carrier_invitations +
-- registered_mini_app_companies). Safe to run repeatedly and independent of Drizzle's migration
-- tracking — use it when the shared external Mytrion OPS DB's __drizzle_migrations is out of sync
-- with the actual schema (e.g. a migration marked applied but the table absent). Consolidates
-- migrations 0020–0024 into CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
--
-- Run:  psql "<MYTRION_OPS_DATABASE_URL>" -f scripts/bootstrap-carrier-schema.sql

CREATE TABLE IF NOT EXISTS "carrier_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "profile" text DEFAULT 'owner' NOT NULL,
  "carrier_id" text,
  "application_id" text,
  "company_name" text,
  "agent_name" text,
  "agent_zoho_user_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "redeemed_carrier_user_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "carrier_invitations" ADD COLUMN IF NOT EXISTS "company_type" text;
ALTER TABLE "carrier_invitations" ADD COLUMN IF NOT EXISTS "card_count" integer;
ALTER TABLE "carrier_invitations" ADD COLUMN IF NOT EXISTS "card_id" text;
ALTER TABLE "carrier_invitations" ADD COLUMN IF NOT EXISTS "driver_name" text;
CREATE INDEX IF NOT EXISTS "carrier_invitations_tenant_idx" ON "carrier_invitations" ("tenant_id");
CREATE INDEX IF NOT EXISTS "carrier_invitations_tenant_carrier_idx" ON "carrier_invitations" ("tenant_id","carrier_id");

CREATE TABLE IF NOT EXISTS "registered_mini_app_companies" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "invitation_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "telegram_chat_id" text,
  "telegram_username" text,
  "carrier_id" text,
  "application_id" text,
  "company_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "company_type" text;
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "card_count" integer;
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "profile" text DEFAULT 'owner' NOT NULL;
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "card_id" text;
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "driver_name" text;
CREATE UNIQUE INDEX IF NOT EXISTS "registered_mini_app_companies_tenant_tg_user_uk" ON "registered_mini_app_companies" ("tenant_id","telegram_user_id");
CREATE INDEX IF NOT EXISTS "registered_mini_app_companies_invitation_idx" ON "registered_mini_app_companies" ("invitation_id");
CREATE INDEX IF NOT EXISTS "registered_mini_app_companies_tenant_carrier_idx" ON "registered_mini_app_companies" ("tenant_id","carrier_id");
