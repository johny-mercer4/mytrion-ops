ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "agent_name" text;
--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN IF NOT EXISTS "agent_zoho_user_id" text;
