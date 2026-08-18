-- Sales Mytrion usage analytics storage.
--
-- Browser telemetry remains append-only during normal application work. The retention job may
-- delete rolled-up raw rows only inside a transaction that enables the scoped setting below;
-- updates remain forbidden in every case.

ALTER TABLE "automation_logs"
  ADD COLUMN IF NOT EXISTS "run_id" text;
--> statement-breakpoint
UPDATE "automation_logs" SET "run_id" = "id" WHERE "run_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "automation_logs" ALTER COLUMN "run_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation_logs"
  ADD COLUMN IF NOT EXISTS "phase" text NOT NULL DEFAULT 'succeeded',
  ADD COLUMN IF NOT EXISTS "duration_ms" integer,
  ADD COLUMN IF NOT EXISTS "error_code" text,
  ADD COLUMN IF NOT EXISTS "source_mytrion" text NOT NULL DEFAULT 'sales',
  ADD COLUMN IF NOT EXISTS "actor_user_id" text,
  ADD COLUMN IF NOT EXISTS "impersonator_user_id" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'automation_logs_phase_check'
  ) THEN
    ALTER TABLE "automation_logs"
      ADD CONSTRAINT "automation_logs_phase_check"
      CHECK ("phase" IN ('started', 'succeeded', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'automation_logs_duration_check'
  ) THEN
    ALTER TABLE "automation_logs"
      ADD CONSTRAINT "automation_logs_duration_check"
      CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_logs_tenant_run_phase_uk"
  ON "automation_logs" ("tenant_id","run_id","phase");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_logs_tenant_run_terminal_uk"
  ON "automation_logs" ("tenant_id","run_id")
  WHERE "phase" IN ('succeeded','failed');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_logs_tenant_actor_time_idx"
  ON "automation_logs" ("tenant_id","actor_user_id","created_at");
--> statement-breakpoint

-- Time-leading indexes serve reporting-range scans before worker/session grouping.
CREATE INDEX IF NOT EXISTS "kpi_presence_events_tenant_time_idx"
  ON "kpi_presence_events" ("tenant_id","received_at","worker_id","session_id","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_tenant_user_time_idx"
  ON "audit_log" ("tenant_id","user_id","created_at");
--> statement-breakpoint

INSERT INTO "kpi_metric_definitions"
  ("id","tenant_id","metric_key","version","label","unit","aggregation","numerator_metric_key","denominator_metric_key")
VALUES
  ('kmd_usage_visible_seconds','octane','online_visible_seconds',1,'Visible online time','seconds','sum',NULL,NULL),
  ('kmd_usage_edit_failures','octane','edit_save_failures',1,'Failed edit saves','count','sum',NULL,NULL),
  ('kmd_usage_view_opens','octane','view_open_clicks',1,'View opens','count','sum',NULL,NULL),
  ('kmd_usage_record_opens','octane','record_open_clicks',1,'Record opens','count','sum',NULL,NULL),
  ('kmd_usage_searches','octane','searches_completed',1,'Completed searches','count','sum',NULL,NULL),
  ('kmd_usage_exports','octane','exports_completed',1,'Completed exports','count','sum',NULL,NULL),
  ('kmd_usage_last_telemetry','octane','last_telemetry_at_epoch_seconds',1,'Last telemetry activity','epoch_seconds','last',NULL,NULL)
ON CONFLICT ("tenant_id","metric_key","version") DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "kpi_reject_telemetry_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('octane.kpi_retention_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_presence_events_immutable" ON "kpi_presence_events";
CREATE TRIGGER "kpi_presence_events_immutable" BEFORE UPDATE OR DELETE ON "kpi_presence_events"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_telemetry_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "kpi_activity_events_immutable" ON "kpi_activity_events";
CREATE TRIGGER "kpi_activity_events_immutable" BEFORE UPDATE OR DELETE ON "kpi_activity_events"
  FOR EACH ROW EXECUTE FUNCTION "kpi_reject_telemetry_mutation"();
