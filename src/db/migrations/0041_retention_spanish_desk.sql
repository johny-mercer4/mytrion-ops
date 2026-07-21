-- Spanish Retention desk signal (DWH nationality / main_language) + optional preferred language label.
ALTER TABLE "retention_cases" ADD COLUMN IF NOT EXISTS "preferred_language" text;
ALTER TABLE "retention_cases" ADD COLUMN IF NOT EXISTS "is_spanish_desk" boolean NOT NULL DEFAULT false;
