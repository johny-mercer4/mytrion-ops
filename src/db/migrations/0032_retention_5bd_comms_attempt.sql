-- OoR channel attempts use a 5 BD SLA (was 1 BD). Type string only — do not rewrite
-- current_deadline_at; the next logged attempt stamps a fresh 5 BD deadline.
UPDATE "retention_cases"
SET "current_deadline_type" = '5BD_comms_attempt'
WHERE "closed_at" IS NULL
  AND "current_deadline_type" = '1BD_comms_attempt';
