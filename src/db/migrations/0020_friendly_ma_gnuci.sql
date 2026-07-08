CREATE TABLE IF NOT EXISTS "retention_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"carrier_id" text NOT NULL,
	"company_name" text,
	"application_id" text,
	"agent_name" text,
	"agent_zoho_user_id" text,
	"phase" text DEFAULT 'sales' NOT NULL,
	"phase_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stage" text DEFAULT 'inactive_no_reason' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"closed_at" timestamp with time zone,
	"inactivity_reason" text,
	"reason_note" text,
	"out_of_reach_attempts" integer DEFAULT 0 NOT NULL,
	"frequency_class" text,
	"threshold_days" integer,
	"last_transaction_at" timestamp with time zone,
	"days_inactive" integer,
	"tx_count_90d" integer,
	"gallons_90d" double precision,
	"active_cards" integer,
	"pool_assignment" text,
	"pool_taken_by" text,
	"source" text DEFAULT 'auto' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retention_cases_tenant_carrier_open_uk" ON "retention_cases" USING btree ("tenant_id","carrier_id") WHERE "retention_cases"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_cases_tenant_phase_idx" ON "retention_cases" USING btree ("tenant_id","phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_cases_tenant_status_idx" ON "retention_cases" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_cases_tenant_carrier_idx" ON "retention_cases" USING btree ("tenant_id","carrier_id");