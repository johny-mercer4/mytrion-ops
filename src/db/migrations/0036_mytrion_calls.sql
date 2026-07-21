-- mytrion_calls — our own outbound call log (independent of RingCentral history), mapping a
-- finished agent-initiated call to the lead / deal / retention case it was placed against.
-- Idempotent (CREATE ... IF NOT EXISTS) so a hand-edited baseline is safe on fresh + existing DBs.
CREATE TABLE IF NOT EXISTS "mytrion_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"caller_zoho_user_id" text NOT NULL,
	"phone_number" text,
	"call_time" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"call_status" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"session_id" text,
	"direction" text,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_calls_tenant_caller_idx" ON "mytrion_calls" USING btree ("tenant_id","caller_zoho_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_calls_tenant_source_idx" ON "mytrion_calls" USING btree ("tenant_id","source_type","source_id");
