-- Auto-working on create + screenshot evidence for non-RC OoR attempts.
ALTER TABLE "retention_case_events" ADD COLUMN IF NOT EXISTS "evidence_url" text;

-- New breach cases start Working (no manual Start working). Flip open New → Working.
UPDATE "retention_cases"
SET "status_code" = 'p1_in_progress',
    "updated_at" = NOW()
WHERE "closed_at" IS NULL
  AND "status_code" = 'p1_new'
  AND "phase_code" = 'phase_1_agent';
