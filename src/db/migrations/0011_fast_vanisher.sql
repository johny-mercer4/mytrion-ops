CREATE TABLE IF NOT EXISTS "file_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_user_id" text,
	"department_access" text,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"s3_key" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" text,
	"agent_task_id" text,
	"conversation_id" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_assets_tenant_idx" ON "file_assets" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_assets_owner_idx" ON "file_assets" USING btree ("tenant_id","owner_user_id");