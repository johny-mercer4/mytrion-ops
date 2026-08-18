-- This file originally also generated DDL for a large batch of comms/tickets/HR schema drift
-- (mytrion_threads, mytrion_tickets, escalations, knowledge_docs/knowledge_chunks columns, etc.).
-- Verified against the live DB on 2026-08-18: every one of those tables/columns/indexes already
-- exists there (applied out-of-band at some point, never recorded in drizzle.__drizzle_migrations
-- -- the exact `drizzle-kit push` anti-pattern CLAUDE.md already bans for shared work). Re-running
-- them here would fail outright: the first CREATE TABLE hits "already exists", and separately
-- knowledge_chunks.retrieval_text / content_hash were being added as NOT NULL with no default
-- against 1,102 live rows, which fails regardless of the already-exists issue.
-- Original full content is preserved in git history (commit b31d93b1) for whoever owns that
-- schema to split into a proper, backfilled migration. This file now applies only the one table
-- that was genuinely missing.
CREATE TABLE IF NOT EXISTS "payment_delete_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"zoho_user_id" text NOT NULL,
	"source" text NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_delete_grants_user_source_uniq" ON "payment_delete_grants" USING btree ("zoho_user_id","source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_delete_grants_source_idx" ON "payment_delete_grants" USING btree ("source");
