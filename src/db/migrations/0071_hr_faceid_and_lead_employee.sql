-- FaceID (Zoho People `Face_ID`) on employees, and department lead as an employee FK.
-- Hand-written (IF NOT EXISTS) — same drizzle snapshot collision reason as 0067/0068.

ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "face_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_face_id_idx"
  ON "hr_employees" ("tenant_id","face_id");
--> statement-breakpoint

-- Backfill Face_ID from the last Zoho People sync payload when present.
UPDATE "hr_employees"
SET "face_id" = NULLIF(TRIM("raw_fields"->>'Face_ID'), '')
WHERE ("face_id" IS NULL OR "face_id" = '')
  AND "raw_fields" IS NOT NULL
  AND COALESCE(TRIM("raw_fields"->>'Face_ID'), '') <> '';
--> statement-breakpoint

ALTER TABLE "hr_departments" ADD COLUMN IF NOT EXISTS "lead_employee_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_departments_tenant_lead_emp_idx"
  ON "hr_departments" ("tenant_id","lead_employee_id");
--> statement-breakpoint

-- Prefer Zoho People Department_Lead.ID → hr_employees.zoho_record_id.
UPDATE "hr_departments" AS d
SET "lead_employee_id" = e."id"
FROM "hr_employees" AS e
WHERE d."tenant_id" = e."tenant_id"
  AND d."lead_employee_id" IS NULL
  AND d."lead_zoho_id" IS NOT NULL
  AND TRIM(d."lead_zoho_id") <> ''
  AND e."zoho_record_id" = d."lead_zoho_id";
--> statement-breakpoint

-- Fallback: unique email match (lead_email → employee email).
UPDATE "hr_departments" AS d
SET "lead_employee_id" = e."id"
FROM "hr_employees" AS e
WHERE d."tenant_id" = e."tenant_id"
  AND d."lead_employee_id" IS NULL
  AND d."lead_email" IS NOT NULL
  AND TRIM(d."lead_email") <> ''
  AND lower(btrim(e."email")) = lower(btrim(d."lead_email"))
  AND (
    SELECT count(*)::int
    FROM "hr_employees" e2
    WHERE e2."tenant_id" = d."tenant_id"
      AND e2."email" IS NOT NULL
      AND lower(btrim(e2."email")) = lower(btrim(d."lead_email"))
  ) = 1;
