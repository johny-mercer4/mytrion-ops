CREATE TABLE IF NOT EXISTS "agent_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"audience" text NOT NULL,
	"agent_key" text NOT NULL,
	"department_access" text,
	"user_id" text,
	"kind" text DEFAULT 'fact' NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"importance" real DEFAULT 0.5 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memories_tenant_idx" ON "agent_memories" USING btree ("tenant_id","agent_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_memories_embedding_idx" ON "agent_memories" USING hnsw ("embedding" vector_cosine_ops);