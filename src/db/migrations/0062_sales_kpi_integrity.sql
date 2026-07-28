-- Forward-only hardening for databases where 0061 was already applied.

ALTER TABLE "kpi_ingestion_runs"
  ADD COLUMN IF NOT EXISTS "unresolved_mappings" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_worker_memberships_worker_fk') THEN
    ALTER TABLE "kpi_worker_memberships"
      ADD CONSTRAINT "kpi_worker_memberships_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "kpi_workers"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_external_facts_worker_fk') THEN
    ALTER TABLE "kpi_external_facts"
      ADD CONSTRAINT "kpi_external_facts_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "kpi_workers"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_external_facts_run_fk') THEN
    ALTER TABLE "kpi_external_facts"
      ADD CONSTRAINT "kpi_external_facts_run_fk" FOREIGN KEY ("ingestion_run_id") REFERENCES "kpi_ingestion_runs"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_presence_sessions_worker_fk') THEN
    ALTER TABLE "kpi_presence_sessions"
      ADD CONSTRAINT "kpi_presence_sessions_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "kpi_workers"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_presence_events_session_fk') THEN
    ALTER TABLE "kpi_presence_events"
      ADD CONSTRAINT "kpi_presence_events_session_fk" FOREIGN KEY ("session_id") REFERENCES "kpi_presence_sessions"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_presence_events_worker_fk') THEN
    ALTER TABLE "kpi_presence_events"
      ADD CONSTRAINT "kpi_presence_events_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "kpi_workers"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_activity_events_worker_fk') THEN
    ALTER TABLE "kpi_activity_events"
      ADD CONSTRAINT "kpi_activity_events_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "kpi_workers"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_daily_rollups_worker_fk') THEN
    ALTER TABLE "kpi_daily_rollups"
      ADD CONSTRAINT "kpi_daily_rollups_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "kpi_workers"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_daily_metric_values_rollup_fk') THEN
    ALTER TABLE "kpi_daily_metric_values"
      ADD CONSTRAINT "kpi_daily_metric_values_rollup_fk" FOREIGN KEY ("rollup_id") REFERENCES "kpi_daily_rollups"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_monthly_snapshots_worker_fk') THEN
    ALTER TABLE "kpi_monthly_snapshots"
      ADD CONSTRAINT "kpi_monthly_snapshots_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "kpi_workers"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kpi_monthly_metric_values_snapshot_fk') THEN
    ALTER TABLE "kpi_monthly_metric_values"
      ADD CONSTRAINT "kpi_monthly_metric_values_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "kpi_monthly_snapshots"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mytrion_worker_task_events_task_fk') THEN
    ALTER TABLE "mytrion_worker_task_events"
      ADD CONSTRAINT "mytrion_worker_task_events_task_fk" FOREIGN KEY ("task_id") REFERENCES "mytrion_worker_tasks"("id") ON DELETE RESTRICT;
  END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "kpi_reject_immutable_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_external_facts_immutable" ON "kpi_external_facts";
CREATE TRIGGER "kpi_external_facts_immutable" BEFORE UPDATE OR DELETE ON "kpi_external_facts"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_immutable_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_presence_events_immutable" ON "kpi_presence_events";
CREATE TRIGGER "kpi_presence_events_immutable" BEFORE UPDATE OR DELETE ON "kpi_presence_events"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_immutable_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_activity_events_immutable" ON "kpi_activity_events";
CREATE TRIGGER "kpi_activity_events_immutable" BEFORE UPDATE OR DELETE ON "kpi_activity_events"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_immutable_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "mytrion_worker_task_events_immutable" ON "mytrion_worker_task_events";
CREATE TRIGGER "mytrion_worker_task_events_immutable" BEFORE UPDATE OR DELETE ON "mytrion_worker_task_events"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_immutable_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_monthly_snapshots_immutable" ON "kpi_monthly_snapshots";
CREATE TRIGGER "kpi_monthly_snapshots_immutable" BEFORE UPDATE OR DELETE ON "kpi_monthly_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_immutable_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_monthly_metric_values_immutable" ON "kpi_monthly_metric_values";
CREATE TRIGGER "kpi_monthly_metric_values_immutable" BEFORE UPDATE OR DELETE ON "kpi_monthly_metric_values"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_immutable_mutation"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "kpi_protect_snapshotted_metric_definition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "kpi_monthly_metric_values" v
    WHERE v."tenant_id" = OLD."tenant_id"
      AND v."metric_key" = OLD."metric_key"
      AND v."metric_version" = OLD."version"
  ) THEN
    RAISE EXCEPTION 'Snapshotted KPI metric definition %.v% is immutable', OLD."metric_key", OLD."version";
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_metric_definitions_snapshot_guard" ON "kpi_metric_definitions";
CREATE TRIGGER "kpi_metric_definitions_snapshot_guard"
  BEFORE UPDATE OR DELETE ON "kpi_metric_definitions"
  FOR EACH ROW EXECUTE FUNCTION "kpi_protect_snapshotted_metric_definition"();
