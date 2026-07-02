CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text,
	"thread_id" text,
	"agent_key" text NOT NULL,
	"status" text NOT NULL,
	"model" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric(12, 6) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "acting_agent" text;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "agent_run_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "acting_agent" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "agent_run_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_conv_idx" ON "agent_runs" USING btree ("tenant_id","conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_tenant_agent_idx" ON "agent_runs" USING btree ("tenant_id","agent_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_calls_agent_run_idx" ON "tool_calls" USING btree ("tenant_id","agent_run_id");