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
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "registered_mini_app_companies_tenant_tg_user_uk" ON "registered_mini_app_companies" USING btree ("tenant_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registered_mini_app_companies_invitation_idx" ON "registered_mini_app_companies" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "registered_mini_app_companies_tenant_carrier_idx" ON "registered_mini_app_companies" USING btree ("tenant_id","carrier_id");