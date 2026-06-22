CREATE TABLE IF NOT EXISTS "scope_risk_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"node_id" text NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"icon" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_risk_items_node_idx" ON "scope_risk_items" USING btree ("tenant_id","node_id","category","position");