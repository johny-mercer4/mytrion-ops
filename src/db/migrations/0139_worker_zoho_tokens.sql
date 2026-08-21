CREATE TABLE IF NOT EXISTS "worker_zoho_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"zoho_user_id" text NOT NULL,
	"refresh_token" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worker_zoho_tokens_tenant_user_uk" ON "worker_zoho_tokens" USING btree ("tenant_id","zoho_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_zoho_tokens_tenant_idx" ON "worker_zoho_tokens" USING btree ("tenant_id");
