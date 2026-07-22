-- Out of Reach per-attempt SLA is 1 business day (product). Rename open markers;
-- deadline *at* is left alone — the next attempt stamp is authoritative.
UPDATE "retention_cases"
SET "current_deadline_type" = '1BD_comms_attempt'
WHERE "closed_at" IS NULL
  AND "current_deadline_type" = '5BD_comms_attempt';
