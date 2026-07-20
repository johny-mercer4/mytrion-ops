-- Phase 1 timer statuses for deadline sweeper (Reached watch, vacation follow-up, Ops signoff).
INSERT INTO "retention_statuses" ("code", "phase_code", "label", "is_terminal") VALUES
  ('p1_reached', 'phase_1_agent', 'Reached — waiting for transaction', false),
  ('p1_vacation_followup', 'phase_1_agent', 'Vacation follow-up (2 BD)', false),
  ('p1_awaiting_ops', 'phase_1_agent', 'Awaiting Ops vacation confirm', false)
ON CONFLICT ("code") DO UPDATE SET
  "phase_code" = EXCLUDED."phase_code",
  "label" = EXCLUDED."label",
  "is_terminal" = EXCLUDED."is_terminal";
