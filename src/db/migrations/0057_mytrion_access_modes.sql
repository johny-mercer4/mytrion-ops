ALTER TABLE "mytrion_role_defaults" ADD COLUMN IF NOT EXISTS "mytrion_access_modes" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "worker_mytrion_access" ADD COLUMN IF NOT EXISTS "mytrion_access_modes" jsonb DEFAULT '{}'::jsonb NOT NULL;
