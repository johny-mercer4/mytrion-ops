ALTER TABLE "retention_cases" ADD COLUMN IF NOT EXISTS "client_name" text;
--> statement-breakpoint
CREATE TABLE "entity_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"content" text NOT NULL,
	"author_zoho_user_id" text,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "entity_notes_tenant_type_entity_idx" ON "entity_notes" USING btree ("tenant_id","entity_type","entity_id","created_at");