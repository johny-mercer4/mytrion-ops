-- Denormalize DWH contact phone onto retention_cases at sync so Sales dial is instant.
ALTER TABLE "retention_cases" ADD COLUMN IF NOT EXISTS "contact_phone" text;
