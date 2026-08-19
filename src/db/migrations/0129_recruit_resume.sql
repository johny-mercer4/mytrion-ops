-- Candidate resumes: the Dropbox reference stored on the candidate row (bytes live in the
-- `dropbox_recruit` folder, /recruit/candidates/<id>/<file>). Hand-written and idempotent so it is
-- safe on both a fresh DB and one where these columns were already added out-of-band.
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_file_key" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_file_name" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_content_type" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_storage_provider" text;--> statement-breakpoint
ALTER TABLE "recruit_candidates" ADD COLUMN IF NOT EXISTS "resume_uploaded_at" timestamp with time zone;
