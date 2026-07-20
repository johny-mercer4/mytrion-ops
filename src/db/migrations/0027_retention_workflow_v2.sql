-- Retention workflow v2: lookup phases/statuses + fixed enums + cases + event audit trail.
-- Replaces the flat 0020/0023 retention_cases shape (episode rows regenerate from DWH sync).

DROP TABLE IF EXISTS "retention_case_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "retention_cases" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "retention_statuses" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "retention_phases" CASCADE;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "communication_channel" AS ENUM (
    'telegram','whatsapp','sms','ringcentral','instagram','facebook','email'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "dissatisfaction_reason" AS ENUM (
    'low_discounts','payment_cycle','cs_service','trust_issues','switched_other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "transaction_frequency" AS ENUM ('high','medium','low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "agent_outcome" AS ENUM (
    'out_of_reach','returned','dissatisfied','vacation','no_action_2bd'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retention_phases" (
  "code" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "sort_order" smallint NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retention_statuses" (
  "code" text PRIMARY KEY NOT NULL,
  "phase_code" text NOT NULL REFERENCES "retention_phases"("code"),
  "label" text NOT NULL,
  "is_terminal" boolean DEFAULT false NOT NULL
);--> statement-breakpoint

INSERT INTO "retention_phases" ("code", "label", "sort_order") VALUES
  ('phase_1_agent', 'Phase 1 · Sales agent', 1),
  ('phase_2_retention', 'Phase 2 · Retention desk', 2),
  ('phase_3_citi', 'Phase 3 · Citi folder', 3)
ON CONFLICT ("code") DO UPDATE SET
  "label" = EXCLUDED."label",
  "sort_order" = EXCLUDED."sort_order";--> statement-breakpoint

-- Statuses grow via INSERT (not ALTER TYPE). is_terminal drives close semantics.
INSERT INTO "retention_statuses" ("code", "phase_code", "label", "is_terminal") VALUES
  ('p1_new', 'phase_1_agent', 'New — awaiting agent', false),
  ('p1_in_progress', 'phase_1_agent', 'Agent working', false),
  ('p1_out_of_reach', 'phase_1_agent', 'Out of reach', false),
  ('p1_vacation', 'phase_1_agent', 'On vacation', false),
  ('p1_dissatisfied', 'phase_1_agent', 'Dissatisfied', false),
  ('p1_no_action_2bd', 'phase_1_agent', 'No action (2BD)', false),
  ('p1_open_pool', 'phase_1_agent', 'Open pool', false),
  ('p1_pool_assigned', 'phase_1_agent', 'Claimed from open pool', false),
  ('p1_returned', 'phase_1_agent', 'Returned', true),
  ('p1_handoff_retention', 'phase_1_agent', 'Handed to Retention', false),
  ('p2_new', 'phase_2_retention', 'Received by Retention', false),
  ('p2_working', 'phase_2_retention', 'Retention working', false),
  ('p2_offer_pending', 'phase_2_retention', 'Offer pending', false),
  ('p2_saved', 'phase_2_retention', 'Saved', true),
  ('p2_refused', 'phase_2_retention', 'Refused offer', true),
  ('p2_lost', 'phase_2_retention', 'Lost', true),
  ('p2_out_of_business', 'phase_2_retention', 'Out of business', true),
  ('p2_no_response', 'phase_2_retention', 'No response', true),
  ('p2_handoff_citi', 'phase_2_retention', 'Escalate to Citi', false),
  ('p3_hold', 'phase_3_citi', 'Citi folder hold', false),
  ('p3_review', 'phase_3_citi', 'Biweekly review', false),
  ('p3_closed', 'phase_3_citi', 'Closed in Citi', true)
ON CONFLICT ("code") DO UPDATE SET
  "phase_code" = EXCLUDED."phase_code",
  "label" = EXCLUDED."label",
  "is_terminal" = EXCLUDED."is_terminal";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retention_cases" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "zoho_deal_id" text,
  "company_name" text,
  "application_id" text,
  "agent_name" text,
  "phase_code" text DEFAULT 'phase_1_agent' NOT NULL REFERENCES "retention_phases"("code"),
  "status_code" text DEFAULT 'p1_new' NOT NULL REFERENCES "retention_statuses"("code"),
  "phase_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "transaction_frequency" "transaction_frequency",
  "agent_outcome" "agent_outcome",
  "dissatisfaction_reason" "dissatisfaction_reason",
  "reason_note" text,
  "assigned_agent_zoho_user_id" text,
  "assignment_count" smallint DEFAULT 1 NOT NULL,
  "open_pool_attempt_count" smallint DEFAULT 0 NOT NULL,
  "out_of_reach_attempts" smallint DEFAULT 0 NOT NULL,
  "deal_owner_changed" boolean DEFAULT false NOT NULL,
  "current_deadline_at" timestamp with time zone,
  "current_deadline_type" text,
  "vacation_countdown_end" timestamp with time zone,
  "citi_folder_entered_at" timestamp with time zone,
  "citi_folder_hold_until" timestamp with time zone,
  "last_review_cycle_at" timestamp with time zone,
  "sales_manager_zoho_user_id" text,
  "threshold_days" integer,
  "last_transaction_at" timestamp with time zone,
  "days_inactive" integer,
  "tx_count_90d" integer,
  "gallons_90d" double precision,
  "active_cards" integer,
  "source" text DEFAULT 'auto' NOT NULL,
  "last_synced_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retention_case_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "case_id" bigint NOT NULL REFERENCES "retention_cases"("id"),
  "from_status" text REFERENCES "retention_statuses"("code"),
  "to_status" text NOT NULL REFERENCES "retention_statuses"("code"),
  "event_type" text NOT NULL,
  "actor_zoho_user_id" text,
  "channel" "communication_channel",
  "notes" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "retention_cases_tenant_carrier_open_uk"
  ON "retention_cases" USING btree ("tenant_id","carrier_id")
  WHERE "closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_cases_tenant_phase_status_idx"
  ON "retention_cases" USING btree ("tenant_id","phase_code","status_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_cases_deadline_idx"
  ON "retention_cases" USING btree ("current_deadline_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_cases_tenant_carrier_idx"
  ON "retention_cases" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_case_events_case_occurred_idx"
  ON "retention_case_events" USING btree ("case_id","occurred_at");
