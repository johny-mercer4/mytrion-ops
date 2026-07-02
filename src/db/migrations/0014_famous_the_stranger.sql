ALTER TABLE "knowledge_docs" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "effective_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "last_verified_at" timestamp with time zone;