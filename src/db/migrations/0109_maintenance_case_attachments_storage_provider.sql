ALTER TABLE "maintenance_case_attachments"
  ADD COLUMN IF NOT EXISTS "storage_provider" text NOT NULL DEFAULT 's3';
