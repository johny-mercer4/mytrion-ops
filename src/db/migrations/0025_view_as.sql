ALTER TABLE "worker_mytrion_access" ADD COLUMN IF NOT EXISTS "view_as_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
