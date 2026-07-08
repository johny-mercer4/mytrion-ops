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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_invitations_tenant_idx" ON "carrier_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_invitations_tenant_carrier_idx" ON "carrier_invitations" USING btree ("tenant_id","carrier_id");