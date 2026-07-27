CREATE TABLE IF NOT EXISTS "kpi_unresolved_worker_mappings" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "source" text NOT NULL,
  "source_key" text NOT NULL,
  "observed_label" text,
  "reason" text NOT NULL,
  "ingestion_run_id" text NOT NULL REFERENCES "kpi_ingestion_runs"("id"),
  "occurrence_count" integer DEFAULT 1 NOT NULL,
  "first_seen_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_worker_id" text REFERENCES "kpi_workers"("id"),
  "resolved_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "kpi_unresolved_worker_mappings_active_uk"
  ON "kpi_unresolved_worker_mappings" ("tenant_id", "source", "source_key")
  WHERE "resolved_at" IS NULL;

CREATE INDEX IF NOT EXISTS "kpi_unresolved_worker_mappings_tenant_status_idx"
  ON "kpi_unresolved_worker_mappings" ("tenant_id", "resolved_at", "last_seen_at");
