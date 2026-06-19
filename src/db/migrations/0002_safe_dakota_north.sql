CREATE TABLE IF NOT EXISTS "automation_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"trigger_time" text,
	"trigger_date" text,
	"automation_type" text NOT NULL,
	"agent_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_logs_tenant_idx" ON "automation_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_logs_type_idx" ON "automation_logs" USING btree ("automation_type");