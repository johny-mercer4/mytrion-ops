-- Shared conversation blackboard + procedural skill cache (SotA Phase 1).

CREATE TABLE IF NOT EXISTS "agent_blackboards" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "audience" text NOT NULL,
  "conversation_id" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_blackboards_tenant_conv_uidx"
  ON "agent_blackboards" ("tenant_id", "conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_blackboards_tenant_idx"
  ON "agent_blackboards" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_skills" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "audience" text NOT NULL,
  "agent_key" text NOT NULL,
  "department_access" text,
  "query_pattern" text NOT NULL,
  "trajectory_json" jsonb NOT NULL,
  "tools_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "schema_version" text DEFAULT '1' NOT NULL,
  "embedding" vector(1536),
  "success_count" integer DEFAULT 1 NOT NULL,
  "importance" real DEFAULT 0.6 NOT NULL,
  "access_count" integer DEFAULT 0 NOT NULL,
  "last_accessed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_tenant_idx"
  ON "agent_skills" ("tenant_id", "agent_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_embedding_idx"
  ON "agent_skills" USING hnsw ("embedding" vector_cosine_ops);
