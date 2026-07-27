CREATE TABLE IF NOT EXISTS "hr_departments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "zoho_record_id" text,
  "name" text NOT NULL,
  "code" text,
  "mail_alias" text,
  "lead_name" text,
  "lead_zoho_id" text,
  "lead_email" text,
  "parent_name" text,
  "parent_zoho_id" text,
  "source" text DEFAULT 'manual' NOT NULL,
  "raw_fields" jsonb,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_departments_tenant_name_idx" ON "hr_departments" ("tenant_id","name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_departments_tenant_zoho_uk" ON "hr_departments" ("tenant_id","zoho_record_id") WHERE "zoho_record_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_departments_tenant_name_uk" ON "hr_departments" ("tenant_id","name");
