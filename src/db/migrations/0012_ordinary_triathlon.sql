CREATE TABLE IF NOT EXISTS "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text,
	"requested_by" text NOT NULL,
	"acting_agent" text,
	"agent_run_id" text,
	"tool_name" text NOT NULL,
	"risk_class" text NOT NULL,
	"arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"ctx_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_tenant_status_idx" ON "approvals" USING btree ("tenant_id","status","created_at");