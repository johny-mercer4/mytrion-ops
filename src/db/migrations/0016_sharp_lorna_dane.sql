CREATE TABLE IF NOT EXISTS "carrier_users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"carrier_id" text NOT NULL,
	"application_id" text,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"agent_name" text,
	"agent_zoho_user_id" text,
	"profile" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "carrier_users_tenant_login_uk" ON "carrier_users" USING btree ("tenant_id","login");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_users_tenant_carrier_idx" ON "carrier_users" USING btree ("tenant_id","carrier_id");