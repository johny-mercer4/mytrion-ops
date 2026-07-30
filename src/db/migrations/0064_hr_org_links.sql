-- Link employees → departments, and departments → parent departments (org tree).
-- Designation stays a free-text / picklist on employees — no hr_designations table.

ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "department_id" text;
--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "department_zoho_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_dept_id_idx"
  ON "hr_employees" ("tenant_id","department_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_dept_zoho_idx"
  ON "hr_employees" ("tenant_id","department_zoho_id");
--> statement-breakpoint

ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "parent_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_departments_tenant_parent_idx"
  ON "hr_departments" ("tenant_id","parent_id");
--> statement-breakpoint

-- Backfill Zoho department id from the last sync payload when present.
UPDATE "hr_employees"
SET "department_zoho_id" = NULLIF(TRIM("raw_fields"->>'Department.ID'), '')
WHERE ("department_zoho_id" IS NULL OR "department_zoho_id" = '')
  AND "raw_fields" IS NOT NULL
  AND COALESCE(TRIM("raw_fields"->>'Department.ID'), '') <> '';
--> statement-breakpoint

-- Resolve department_id by Zoho record id (preferred).
UPDATE "hr_employees" AS e
SET "department_id" = d."id"
FROM "hr_departments" AS d
WHERE e."tenant_id" = d."tenant_id"
  AND e."department_id" IS NULL
  AND e."department_zoho_id" IS NOT NULL
  AND d."zoho_record_id" = e."department_zoho_id";
--> statement-breakpoint

-- Fallback: resolve department_id by exact department name.
UPDATE "hr_employees" AS e
SET "department_id" = d."id"
FROM "hr_departments" AS d
WHERE e."tenant_id" = d."tenant_id"
  AND e."department_id" IS NULL
  AND e."department" IS NOT NULL
  AND TRIM(e."department") <> ''
  AND d."name" = e."department";
--> statement-breakpoint

-- Resolve department parent_id from parent_zoho_id → sibling zoho_record_id.
UPDATE "hr_departments" AS child
SET "parent_id" = parent."id"
FROM "hr_departments" AS parent
WHERE child."tenant_id" = parent."tenant_id"
  AND child."parent_id" IS NULL
  AND child."parent_zoho_id" IS NOT NULL
  AND TRIM(child."parent_zoho_id") <> ''
  AND parent."zoho_record_id" = child."parent_zoho_id";
