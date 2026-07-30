CREATE TABLE IF NOT EXISTS "support_bot_memories" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "chat_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'turn_summary',
  "content" text NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "source_hash" text NOT NULL,
  "importance" real NOT NULL DEFAULT 0.5,
  "expires_at" timestamp with time zone NOT NULL,
  "last_accessed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "support_bot_memories_scope_recent_idx"
  ON "support_bot_memories"
  ("tenant_id", "carrier_id", "chat_id", "telegram_user_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_memories_scope_hash_uq"
  ON "support_bot_memories"
  ("tenant_id", "carrier_id", "chat_id", "telegram_user_id", "source_hash");

CREATE INDEX IF NOT EXISTS "support_bot_memories_embedding_idx"
  ON "support_bot_memories"
  USING hnsw ("embedding" vector_cosine_ops);
