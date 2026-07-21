-- Sales Agent Phase 1 board alignment:
--   New → Reached / Out of Reach / Vacation / Dissatisfied → Closed
-- Adds board_column + sort_order on status lookups; labels match the Kanban;
-- agent_outcome gains 'reached' (was overloaded onto 'returned' while watching).

ALTER TABLE "retention_statuses"
  ADD COLUMN IF NOT EXISTS "board_column" text;
--> statement-breakpoint
ALTER TABLE "retention_statuses"
  ADD COLUMN IF NOT EXISTS "sort_order" smallint NOT NULL DEFAULT 100;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TYPE "agent_outcome" ADD VALUE 'reached';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

UPDATE "retention_phases"
SET "label" = 'Phase 1 · Sales Agent'
WHERE "code" = 'phase_1_agent';
--> statement-breakpoint

-- Refresh Phase 1 (+ shared) status labels and board columns.
INSERT INTO "retention_statuses" ("code", "phase_code", "label", "is_terminal", "board_column", "sort_order") VALUES
  ('p1_new', 'phase_1_agent', 'New — call within 2 BD', false, 'new', 10),
  ('p1_in_progress', 'phase_1_agent', 'New — call within 2 BD', false, 'new', 11),
  ('p1_pool_assigned', 'phase_1_agent', 'New — claimed from Open Pool', false, 'new', 12),
  ('p1_reached', 'phase_1_agent', 'Reached — watching for fuel (5 BD)', false, 'reached', 20),
  ('p1_out_of_reach', 'phase_1_agent', 'Out of Reach — channel attempts (5×5 BD)', false, 'out_of_reach', 30),
  ('p1_vacation', 'phase_1_agent', 'Vacation — 14-day countdown', false, 'vacation', 40),
  ('p1_vacation_followup', 'phase_1_agent', 'Vacation — follow-up (2 BD)', false, 'vacation', 41),
  ('p1_awaiting_ops', 'phase_1_agent', 'Vacation — awaiting Ops confirm', false, 'vacation', 42),
  ('p1_dissatisfied', 'phase_1_agent', 'Dissatisfied — handoff to Retention', false, 'dissatisfied', 50),
  ('p1_no_action_2bd', 'phase_1_agent', 'Closed — no action (2 BD)', false, 'closed', 60),
  ('p1_open_pool', 'phase_1_agent', 'Closed — Open Pool', false, 'closed', 61),
  ('p1_pool_claim_pending', 'phase_1_agent', 'Closed — claim pending', false, 'closed', 62),
  ('p1_returned', 'phase_1_agent', 'Closed — returned (new fuel)', true, 'closed', 63),
  ('p1_handoff_retention', 'phase_1_agent', 'Closed — handed to Retention', false, 'closed', 64),
  ('p2_new', 'phase_2_retention', 'Retention — received', false, NULL, 70),
  ('p2_working', 'phase_2_retention', 'Retention — working', false, NULL, 71),
  ('p3_hold', 'phase_3_citi', 'CITI — hold', false, 'closed', 80),
  ('p3_closed', 'phase_3_citi', 'Closed — CITI', true, 'closed', 81)
ON CONFLICT ("code") DO UPDATE SET
  "phase_code" = EXCLUDED."phase_code",
  "label" = EXCLUDED."label",
  "is_terminal" = EXCLUDED."is_terminal",
  "board_column" = EXCLUDED."board_column",
  "sort_order" = EXCLUDED."sort_order";
--> statement-breakpoint

-- Keep deadline type string consistent (idempotent with 0032).
UPDATE "retention_cases"
SET "current_deadline_type" = '5BD_comms_attempt'
WHERE "closed_at" IS NULL
  AND "current_deadline_type" = '1BD_comms_attempt';

-- Open Reached rows may still have agent_outcome='returned' until next status write;
-- app stamps 'reached' going forward. Do not UPDATE to 'reached' here — Postgres forbids
-- using a new enum value in the same transaction that added it (drizzle migrates in one txn).
