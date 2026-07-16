CREATE TABLE IF NOT EXISTS "carrier_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"profile" text DEFAULT 'owner' NOT NULL,
	"carrier_id" text,
	"application_id" text,
	"company_name" text,
	"card_id" text,
	"driver_name" text,
	"company_type" text,
	"card_count" integer,
	"agent_name" text,
	"agent_zoho_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"redeemed_carrier_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "registered_mini_app_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"invitation_id" text NOT NULL,
	"profile" text DEFAULT 'owner' NOT NULL,
	"telegram_user_id" text NOT NULL,
	"telegram_chat_id" text,
	"telegram_username" text,
	"carrier_id" text,
	"application_id" text,
	"company_name" text,
	"agent_name" text,
	"agent_zoho_user_id" text,
	"card_id" text,
	"driver_name" text,
	"company_type" text,
	"card_count" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_invitations_tenant_idx" ON "carrier_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_invitations_tenant_carrier_idx" ON "carrier_invitations" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registered_mini_app_companies_tenant_tg_user_uk" ON "registered_mini_app_companies" USING btree ("tenant_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registered_mini_app_companies_invitation_idx" ON "registered_mini_app_companies" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registered_mini_app_companies_tenant_carrier_idx" ON "registered_mini_app_companies" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "agent_name" text;
--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "agent_zoho_user_id" text;
