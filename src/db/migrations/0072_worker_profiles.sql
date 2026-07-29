-- Per-worker profile prefs (avatar). Hand-written IF NOT EXISTS — same drizzle snapshot
-- collision reason as recent HR migrations.

CREATE TABLE IF NOT EXISTS "worker_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "zoho_user_id" text NOT NULL,
  "avatar_data_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worker_profiles_tenant_user_uk"
  ON "worker_profiles" ("tenant_id","zoho_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_profiles_tenant_idx"
  ON "worker_profiles" ("tenant_id");
