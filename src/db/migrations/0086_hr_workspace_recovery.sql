-- Recover HR policy seeds for installations whose runtime tenant is not represented in `tenants`.
-- Existing HR data is tenant-scoped by the literal tenant_id, so discover those tenants from the
-- HR/access tables and always include the application's default `octane` tenant.

CREATE TEMP TABLE "_hr_recovery_tenants" ON COMMIT DROP AS
SELECT DISTINCT "tenant_id"
FROM (
  SELECT "tenant_id" FROM "hr_employees"
  UNION ALL
  SELECT "tenant_id" FROM "hr_leave_settings"
  UNION ALL
  SELECT "tenant_id" FROM "mytrion_profile_defaults"
  UNION ALL
  SELECT 'octane'::text
) tenant_scope
WHERE "tenant_id" IS NOT NULL AND btrim("tenant_id") <> '';
--> statement-breakpoint

INSERT INTO "hr_leave_types"
  ("id","tenant_id","code","name","is_paid","default_days","is_active","sort_order")
SELECT
  'hrlt_' || policy.code || '_' || substr(md5(tenant."tenant_id"), 1, 18),
  tenant."tenant_id",
  policy.code,
  policy.name,
  policy.is_paid,
  policy.default_days,
  true,
  policy.sort_order
FROM "_hr_recovery_tenants" tenant
CROSS JOIN (
  VALUES
    ('sick', 'Sick Leave', true, 7.00::numeric, 10),
    ('annual_paid', 'Annual Paid Leave', true, 17.50::numeric, 20),
    ('unpaid', 'Unpaid Leave', false, 60.00::numeric, 30)
) AS policy(code, name, is_paid, default_days, sort_order)
ON CONFLICT ("tenant_id","code") DO NOTHING;
--> statement-breakpoint

INSERT INTO "hr_leave_settings"
  ("id","tenant_id","final_approver_employee_id","timezone")
SELECT
  'hrls_' || substr(md5(tenant."tenant_id"), 1, 24),
  tenant."tenant_id",
  (
    SELECT employee."id"
    FROM "hr_employees" employee
    WHERE employee."tenant_id" = tenant."tenant_id"
      AND lower(btrim(employee."first_name")) = 'kristina'
      AND lower(btrim(employee."last_name")) = 'smirnova'
      AND lower(btrim(employee."status")) = 'active'
      AND nullif(btrim(employee."zoho_user_id"), '') IS NOT NULL
    ORDER BY employee."updated_at" DESC
    LIMIT 1
  ),
  'Asia/Tashkent'
FROM "_hr_recovery_tenants" tenant
ON CONFLICT ("tenant_id") DO UPDATE
SET "final_approver_employee_id" = COALESCE(
      "hr_leave_settings"."final_approver_employee_id",
      EXCLUDED."final_approver_employee_id"
    ),
    "updated_at" = now();
--> statement-breakpoint

INSERT INTO "hr_leave_entitlements"
  ("id","tenant_id","employee_id","leave_type_id","year","allocated_days","adjustment_days")
SELECT
  'hrle_' || substr(md5(
    employee."tenant_id" || ':' || employee."id" || ':' || leave_type."id" || ':' ||
    extract(year from current_date)::text
  ), 1, 24),
  employee."tenant_id",
  employee."id",
  leave_type."id",
  extract(year from current_date)::integer,
  leave_type."default_days",
  0
FROM "hr_employees" employee
JOIN "hr_leave_types" leave_type
  ON leave_type."tenant_id" = employee."tenant_id"
 AND leave_type."is_active" = true
WHERE lower(btrim(employee."status")) = 'active'
ON CONFLICT ("tenant_id","employee_id","leave_type_id","year") DO NOTHING;
--> statement-breakpoint

INSERT INTO "hr_holidays"
  ("id","tenant_id","date","name","location","is_half_day","is_active")
SELECT
  'hrh_' || replace(holiday.day::text, '-', '') || '_' ||
    substr(md5(tenant."tenant_id" || holiday.name), 1, 12),
  tenant."tenant_id",
  holiday.day,
  holiday.name,
  'Uzbekistan',
  false,
  true
FROM "_hr_recovery_tenants" tenant
CROSS JOIN (
  VALUES
    ('2026-01-01'::date, 'New Year''s Day'),
    ('2026-01-02'::date, 'New Year''s Day'),
    ('2026-03-20'::date, 'Eid Al-Fitr (Ramadan Hayit)'),
    ('2026-05-25'::date, 'Memorial Day'),
    ('2026-05-26'::date, 'Eid al-Adha (Kurban Bayram)'),
    ('2026-07-04'::date, 'Independence Day'),
    ('2026-09-07'::date, 'Labour Day'),
    ('2026-10-12'::date, 'Thanksgiving Day'),
    ('2026-11-11'::date, 'Veterans Day'),
    ('2026-12-25'::date, 'Christmas'),
    ('2026-12-31'::date, 'New Year''s Eve')
) AS holiday(day, name)
ON CONFLICT ("tenant_id","date","name") DO NOTHING;
--> statement-breakpoint

INSERT INTO "mytrion_profile_defaults"
  ("id","tenant_id","profile_name","profile_key","allowed_mytrions","home_mytrion",
   "all_department_access","active")
SELECT
  'pd_hr_' || substr(md5(tenant."tenant_id"), 1, 20),
  tenant."tenant_id",
  'HR',
  'hr',
  '["hr","recruit"]'::jsonb,
  'hr',
  false,
  true
FROM "_hr_recovery_tenants" tenant
ON CONFLICT ("tenant_id","profile_key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "mytrion_profile_defaults"
  ("id","tenant_id","profile_name","profile_key","allowed_mytrions","home_mytrion",
   "all_department_access","active")
SELECT
  'pd_hr_manager_' || substr(md5(tenant."tenant_id"), 1, 12),
  tenant."tenant_id",
  'HR Manager',
  'hr manager',
  '["hr","recruit"]'::jsonb,
  'hr',
  false,
  true
FROM "_hr_recovery_tenants" tenant
ON CONFLICT ("tenant_id","profile_key") DO NOTHING;
--> statement-breakpoint

UPDATE "mytrion_profile_defaults"
SET "allowed_mytrions" = "allowed_mytrions" || '["hr"]'::jsonb,
    "updated_at" = now()
WHERE ("profile_key" IN ('hr', 'hr manager') OR "all_department_access" = true)
  AND NOT ("allowed_mytrions" ? 'hr');
