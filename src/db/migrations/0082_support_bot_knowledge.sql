CREATE TABLE IF NOT EXISTS "support_bot_knowledge_articles" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "carrier_id" text DEFAULT '*' NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "keywords" text DEFAULT '' NOT NULL,
  "service_id" text,
  "knowledge_type" text DEFAULT 'static' NOT NULL,
  "risk_class" text DEFAULT 'read' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "source" text,
  "source_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "effective_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "last_verified_at" timestamp with time zone,
  "embedding" vector(1536),
  "content_tsv" tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'simple',
      coalesce("title", '') || ' ' || coalesce("content", '') || ' ' || coalesce("keywords", '')
    )
  ) STORED,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_knowledge_scope_slug_uq"
  ON "support_bot_knowledge_articles" ("tenant_id", "carrier_id", "slug");

CREATE INDEX IF NOT EXISTS "support_bot_knowledge_scope_status_idx"
  ON "support_bot_knowledge_articles" ("tenant_id", "carrier_id", "status");

CREATE INDEX IF NOT EXISTS "support_bot_knowledge_service_idx"
  ON "support_bot_knowledge_articles" ("tenant_id", "service_id");

CREATE INDEX IF NOT EXISTS "support_bot_knowledge_embedding_idx"
  ON "support_bot_knowledge_articles"
  USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "support_bot_knowledge_tsv_idx"
  ON "support_bot_knowledge_articles"
  USING gin ("content_tsv");
