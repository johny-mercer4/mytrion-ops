-- Sales KPI collection foundation. Raw facts/events remain append-only; daily rollups are
-- recomputable and month snapshots are immutable revisions.

ALTER TABLE "mytrion_calls" ALTER COLUMN "source_type" DROP NOT NULL;
--> statement-breakpoint
-- Legacy seed/test rows can share (tenant_id, session_id); keep the newest, null the rest
-- so the unique index can apply on fresh and existing DBs alike.
WITH dups AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, session_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM mytrion_calls
  WHERE session_id IS NOT NULL
)
UPDATE mytrion_calls AS c
SET session_id = NULL
FROM dups
WHERE c.id = dups.id AND dups.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_calls_tenant_session_uk"
  ON "mytrion_calls" ("tenant_id","session_id") WHERE "session_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_population_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "profile_name" text NOT NULL,
  "normalized_profile_name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_population_profiles_tenant_profile_uk"
  ON "kpi_population_profiles" ("tenant_id","normalized_profile_name");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_workers" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "zoho_user_id" text NOT NULL,
  "display_name" text,
  "email" text,
  "current_profile_name" text,
  "current_role_name" text,
  "source_active" boolean DEFAULT true NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_workers_tenant_zoho_uk"
  ON "kpi_workers" ("tenant_id","zoho_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_workers_tenant_active_idx"
  ON "kpi_workers" ("tenant_id","source_active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_worker_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "profile_name" text NOT NULL,
  "eligible_from" timestamp with time zone DEFAULT now() NOT NULL,
  "eligible_to" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_worker_memberships_open_uk"
  ON "kpi_worker_memberships" ("tenant_id","worker_id") WHERE "eligible_to" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_worker_memberships_worker_time_idx"
  ON "kpi_worker_memberships" ("tenant_id","worker_id","eligible_from");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_metric_definitions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "metric_key" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "label" text NOT NULL,
  "unit" text NOT NULL,
  "aggregation" text NOT NULL,
  "numerator_metric_key" text,
  "denominator_metric_key" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_metric_definitions_tenant_key_version_uk"
  ON "kpi_metric_definitions" ("tenant_id","metric_key","version");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_ingestion_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "source" text NOT NULL,
  "mode" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "window_start" timestamp with time zone,
  "window_end" timestamp with time zone,
  "cursor" text,
  "records_seen" integer DEFAULT 0 NOT NULL,
  "records_written" integer DEFAULT 0 NOT NULL,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_ingestion_runs_tenant_source_idx"
  ON "kpi_ingestion_runs" ("tenant_id","source","started_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_external_facts" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "ingestion_run_id" text NOT NULL,
  "source" text NOT NULL,
  "source_key" text NOT NULL,
  "metric_key" text NOT NULL,
  "metric_version" integer DEFAULT 1 NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "reporting_date" date NOT NULL,
  "numeric_value" double precision NOT NULL,
  "data_status" text DEFAULT 'complete' NOT NULL,
  "dimensions" jsonb,
  "supersedes_id" bigint,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_external_facts_source_revision_uk"
  ON "kpi_external_facts" ("tenant_id","source","source_key","metric_key","revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_external_facts_worker_date_idx"
  ON "kpi_external_facts" ("tenant_id","worker_id","reporting_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_presence_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_presence_sessions_worker_open_idx"
  ON "kpi_presence_sessions" ("tenant_id","worker_id","ended_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_presence_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "session_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "client_event_id" text NOT NULL,
  "state" text NOT NULL,
  "client_occurred_at" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_presence_events_client_event_uk"
  ON "kpi_presence_events" ("tenant_id","client_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_presence_events_session_time_idx"
  ON "kpi_presence_events" ("tenant_id","session_id","received_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_activity_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "session_id" text,
  "client_event_id" text NOT NULL,
  "event_name" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "outcome" text,
  "metadata" jsonb,
  "client_occurred_at" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_activity_events_client_event_uk"
  ON "kpi_activity_events" ("tenant_id","client_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kpi_activity_events_worker_time_idx"
  ON "kpi_activity_events" ("tenant_id","worker_id","received_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_daily_rollups" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "reporting_date" date NOT NULL,
  "timezone" text DEFAULT 'America/New_York' NOT NULL,
  "calculation_version" integer DEFAULT 1 NOT NULL,
  "source_watermarks" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_daily_rollups_worker_date_version_uk"
  ON "kpi_daily_rollups" ("tenant_id","worker_id","reporting_date","calculation_version");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_daily_metric_values" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "rollup_id" text NOT NULL,
  "metric_key" text NOT NULL,
  "metric_version" integer DEFAULT 1 NOT NULL,
  "numeric_value" double precision,
  "numerator" double precision,
  "denominator" double precision,
  "data_status" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_daily_metric_values_rollup_metric_uk"
  ON "kpi_daily_metric_values" ("tenant_id","rollup_id","metric_key","metric_version");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_monthly_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "worker_id" text NOT NULL,
  "period_start" date NOT NULL,
  "revision" integer NOT NULL,
  "timezone" text DEFAULT 'America/New_York' NOT NULL,
  "worker_profile_name" text,
  "worker_role_name" text,
  "source_watermarks" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "finalized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_monthly_snapshots_worker_period_revision_uk"
  ON "kpi_monthly_snapshots" ("tenant_id","worker_id","period_start","revision");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kpi_monthly_metric_values" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "snapshot_id" text NOT NULL,
  "metric_key" text NOT NULL,
  "metric_version" integer DEFAULT 1 NOT NULL,
  "numeric_value" double precision,
  "numerator" double precision,
  "denominator" double precision,
  "data_status" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "kpi_monthly_metric_values_snapshot_metric_uk"
  ON "kpi_monthly_metric_values" ("tenant_id","snapshot_id","metric_key","metric_version");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mytrion_task_types" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_task_types_tenant_code_uk"
  ON "mytrion_task_types" ("tenant_id","code");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mytrion_worker_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "assignee_zoho_user_id" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "source" text NOT NULL,
  "webhook_key_id" text,
  "idempotency_key" text,
  "payload_hash" text,
  "external_id" text,
  "task_type" text NOT NULL,
  "subject" text NOT NULL,
  "description" text,
  "content" jsonb,
  "priority" text DEFAULT 'normal' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "deadline_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_worker_tasks_webhook_idempotency_uk"
  ON "mytrion_worker_tasks" ("tenant_id","webhook_key_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_worker_tasks_assignee_status_idx"
  ON "mytrion_worker_tasks" ("tenant_id","assignee_zoho_user_id","status","deadline_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_worker_tasks_tenant_created_idx"
  ON "mytrion_worker_tasks" ("tenant_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mytrion_worker_task_events" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "task_id" text NOT NULL,
  "event_type" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "from_status" text,
  "to_status" text,
  "detail" jsonb,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mytrion_worker_task_events_task_time_idx"
  ON "mytrion_worker_task_events" ("tenant_id","task_id","occurred_at");
--> statement-breakpoint

INSERT INTO "kpi_population_profiles"
  ("id","tenant_id","profile_name","normalized_profile_name")
VALUES ('kpp_sales_agent','octane','Sales Agent','sales agent')
ON CONFLICT ("tenant_id","normalized_profile_name") DO NOTHING;
--> statement-breakpoint

INSERT INTO "mytrion_task_types" ("id","tenant_id","code","label")
VALUES ('mtt_general','octane','general','General')
ON CONFLICT ("tenant_id","code") DO NOTHING;
--> statement-breakpoint

INSERT INTO "kpi_metric_definitions"
  ("id","tenant_id","metric_key","version","label","unit","aggregation","numerator_metric_key","denominator_metric_key")
VALUES
  ('kmd_mytrion_calls','octane','calls_mytrion',1,'Mytrion calls placed','count','sum',NULL,NULL),
  ('kmd_zoho_calls','octane','calls_zoho',1,'Zoho calls logged','count','sum',NULL,NULL),
  ('kmd_calls_answered','octane','calls_answered',1,'Answered calls','count','sum',NULL,NULL),
  ('kmd_talk_seconds','octane','call_talk_seconds',1,'Call talk time','seconds','sum',NULL,NULL),
  ('kmd_applications','octane','applications',1,'Applications','count','sum',NULL,NULL),
  ('kmd_tasks_assigned','octane','tasks_assigned',1,'Tasks assigned','count','sum',NULL,NULL),
  ('kmd_tasks_due','octane','tasks_due',1,'Tasks due','count','sum',NULL,NULL),
  ('kmd_tasks_completed','octane','tasks_completed',1,'Tasks completed','count','sum',NULL,NULL),
  ('kmd_tasks_on_time','octane','tasks_completed_on_time',1,'Tasks completed on time','count','sum',NULL,NULL),
  ('kmd_tasks_open','octane','tasks_open_end',1,'Open tasks at period end','count','last',NULL,NULL),
  ('kmd_tasks_overdue','octane','tasks_overdue_end',1,'Overdue tasks at period end','count','last',NULL,NULL),
  ('kmd_task_completion_rate','octane','task_completion_rate',1,'Task completion rate','ratio','ratio','tasks_completed','tasks_due'),
  ('kmd_task_on_time_rate','octane','task_on_time_rate',1,'On-time completion rate','ratio','ratio','tasks_completed_on_time','tasks_due'),
  ('kmd_online_seconds','octane','online_active_seconds',1,'Active online time','seconds','sum',NULL,NULL),
  ('kmd_lead_open','octane','lead_open_clicks',1,'Lead opens','count','sum',NULL,NULL),
  ('kmd_deal_open','octane','deal_open_clicks',1,'Deal opens','count','sum',NULL,NULL),
  ('kmd_call_click','octane','call_clicks',1,'Call clicks','count','sum',NULL,NULL),
  ('kmd_edit_open','octane','edit_open_clicks',1,'Edit opens','count','sum',NULL,NULL),
  ('kmd_edit_save','octane','edit_save_successes',1,'Successful edits','count','sum',NULL,NULL),
  ('kmd_tab_open','octane','tab_open_clicks',1,'Tab opens','count','sum',NULL,NULL),
  ('kmd_card_swipes','octane','card_swipes',1,'Card swipes','count','sum',NULL,NULL)
ON CONFLICT ("tenant_id","metric_key","version") DO NOTHING;
