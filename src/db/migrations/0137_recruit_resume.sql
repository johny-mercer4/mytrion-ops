-- Candidate resumes: the Dropbox reference stored on the candidate row (bytes live in the
-- `dropbox_recruit` folder, /recruit/candidates/<id>/<file>). Hand-written and idempotent so it is
-- safe on both a fresh DB and one where these columns were already added out-of-band.
--
-- RENUMBERED 0129 -> 0135 -> 0137 on 2026-08-21 (0135 collided with build's
-- 0135_verification_stage0_routing on the build merge). As 0129 its `when` was 1786997506836, BELOW production's
-- applied high-water mark, so Drizzle skipped it silently and exited green: prod never got these
-- five columns while `recruitRepo.listCandidates` selected them, and GET /v1/recruit/candidates
-- returned 500 with `column "resume_file_key" does not exist`. Restamping above the mark is what
-- makes it run. Safe to re-run anywhere thanks to ADD COLUMN IF NOT EXISTS.
-- See tests/unit/migration-journal.test.ts for the guard that catches the decreasing-`when` shape.
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_file_key" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_file_name" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_content_type" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_storage_provider" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_uploaded_at" timestamp with time zone;
