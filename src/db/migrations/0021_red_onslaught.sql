CREATE TABLE IF NOT EXISTS "inbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"tag" text,
	"type" text NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_events_tenant_owner_idx" ON "inbox_events" USING btree ("tenant_id","owner_kind","owner_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_events_tenant_type_idx" ON "inbox_events" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_events_tenant_tag_idx" ON "inbox_events" USING btree ("tenant_id","tag");