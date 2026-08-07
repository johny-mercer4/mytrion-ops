ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "domain" text NOT NULL DEFAULT 'operations';
ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'en';
ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "authority_class" text NOT NULL DEFAULT 'manual';
ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "owner" text;
ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "source_version" text NOT NULL DEFAULT '1';
ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "source_commit" text;
ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "supersedes_doc_id" text;
ALTER TABLE "knowledge_docs" ADD COLUMN IF NOT EXISTS "verification_status" text NOT NULL DEFAULT 'unverified';

-- Preserve duplicate historical docs while making future checksum admission race-safe.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY tenant_id, audience, checksum
    ORDER BY (status = 'ready') DESC, updated_at DESC, id DESC
  ) AS rn
  FROM knowledge_docs
  WHERE checksum IS NOT NULL
)
UPDATE knowledge_docs d SET checksum = NULL
FROM ranked r
WHERE d.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_docs_tenant_audience_checksum_uidx"
  ON "knowledge_docs" ("tenant_id", "audience", "checksum") WHERE "checksum" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "knowledge_docs_domain_idx"
  ON "knowledge_docs" ("tenant_id", "audience", "domain");

ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "retrieval_text" text;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "section_path" text;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "content_hash" text;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embedding_model" text NOT NULL DEFAULT 'text-embedding-3-small';
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embedding_dimensions" integer NOT NULL DEFAULT 1536;
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "source_version" text NOT NULL DEFAULT '1';

UPDATE "knowledge_chunks"
SET "retrieval_text" = "content", "content_hash" = md5("content")
WHERE "retrieval_text" IS NULL OR "content_hash" IS NULL;
ALTER TABLE "knowledge_chunks" ALTER COLUMN "retrieval_text" SET NOT NULL;
ALTER TABLE "knowledge_chunks" ALTER COLUMN "content_hash" SET NOT NULL;

ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "content_tsv_simple" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "retrieval_text")) STORED;
WITH ranked_chunks AS (
  SELECT id, row_number() OVER (
    PARTITION BY doc_id, chunk_index ORDER BY id DESC
  ) AS rn
  FROM knowledge_chunks
)
DELETE FROM knowledge_chunks c
USING ranked_chunks r
WHERE c.id = r.id AND r.rn > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_doc_chunk_uidx"
  ON "knowledge_chunks" ("doc_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_tsv_simple_idx"
  ON "knowledge_chunks" USING gin ("content_tsv_simple");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_content_hash_idx"
  ON "knowledge_chunks" ("tenant_id", "content_hash");

CREATE TABLE IF NOT EXISTS "rag_runs" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text,
  "agent_run_id" text,
  "query_hash" text NOT NULL,
  "route" text NOT NULL,
  "grade" text NOT NULL,
  "confidence" numeric(5,4) NOT NULL DEFAULT 0,
  "abstained" boolean NOT NULL DEFAULT false,
  "hops" integer NOT NULL DEFAULT 0,
  "candidate_count" integer NOT NULL DEFAULT 0,
  "selected_count" integer NOT NULL DEFAULT 0,
  "retrieval_strategy" text NOT NULL DEFAULT 'exact',
  "duration_ms" integer,
  "stage_trace" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "rag_runs_tenant_created_idx" ON "rag_runs" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "rag_runs_agent_run_idx" ON "rag_runs" ("tenant_id", "agent_run_id");

CREATE TABLE IF NOT EXISTS "llm_calls" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text,
  "agent_run_id" text,
  "role" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "status" text NOT NULL,
  "latency_ms" integer,
  "ttft_ms" integer,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "cached_input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "reasoning_tokens" integer NOT NULL DEFAULT 0,
  "estimated_cost" numeric(12,6) NOT NULL DEFAULT 0,
  "retry_count" integer NOT NULL DEFAULT 0,
  "fallback_from" text,
  "request_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "llm_calls_tenant_created_idx" ON "llm_calls" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "llm_calls_agent_run_idx" ON "llm_calls" ("tenant_id", "agent_run_id");
CREATE INDEX IF NOT EXISTS "llm_calls_model_idx" ON "llm_calls" ("tenant_id", "provider", "model", "created_at");
