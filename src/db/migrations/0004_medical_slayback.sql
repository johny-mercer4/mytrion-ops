ALTER TABLE "conversations" ADD COLUMN "zoho_user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "user_name" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "profile" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "department_scope" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "message_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_message_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "department_scope" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "rag_passages" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tools" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_user_recent_idx" ON "conversations" USING btree ("tenant_id","user_id","last_message_at");