CREATE TABLE IF NOT EXISTS "hr_employees" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "zoho_record_id" text,
  "employee_id" text,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "email" text,
  "department" text,
  "designation" text,
  "location" text,
  "status" text DEFAULT 'Active' NOT NULL,
  "role" text,
  "date_of_joining" text,
  "mobile" text,
  "reporting_to" text,
  "reporting_to_zoho_id" text,
  "photo_url" text,
  "source" text DEFAULT 'manual' NOT NULL,
  "raw_fields" jsonb,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_idx" ON "hr_employees" ("tenant_id","status","last_name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employees_tenant_zoho_uk" ON "hr_employees" ("tenant_id","zoho_record_id") WHERE "zoho_record_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employees_tenant_employee_id_uk" ON "hr_employees" ("tenant_id","employee_id") WHERE "employee_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_email_idx" ON "hr_employees" ("tenant_id","email");
