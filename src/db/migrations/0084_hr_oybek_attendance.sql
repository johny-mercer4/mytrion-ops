-- Oybek is the only authoritative office for HR attendance.
-- Seed the 19:00–03:00 Asia/Tashkent shift and assign every active employee except
-- Canada / US departments. IDs are deterministic so the migration is idempotent.

INSERT INTO "hr_attendance_shifts" (
  "id", "tenant_id", "name", "timezone", "start_local", "end_local", "is_active"
)
SELECT DISTINCT
  'hrs_uzb_' || substr(md5("tenant_id"), 1, 20),
  "tenant_id",
  'UZB Tashkent · Oybek',
  'Asia/Tashkent',
  '19:00',
  '03:00',
  true
FROM "hr_employees"
ON CONFLICT ("tenant_id", "name") DO UPDATE SET
  "timezone" = EXCLUDED."timezone",
  "start_local" = EXCLUDED."start_local",
  "end_local" = EXCLUDED."end_local",
  "is_active" = true,
  "updated_at" = now();
--> statement-breakpoint

INSERT INTO "hr_attendance_shift_assignments" (
  "id", "tenant_id", "employee_id", "shift_id", "effective_from", "effective_to"
)
SELECT
  'hrsa_uzb_' || substr(md5(employee."tenant_id" || ':' || employee."id"), 1, 18),
  employee."tenant_id",
  employee."id",
  shift."id",
  DATE '2026-07-30',
  NULL
FROM "hr_employees" employee
JOIN "hr_attendance_shifts" shift
  ON shift."tenant_id" = employee."tenant_id"
 AND shift."name" = 'UZB Tashkent · Oybek'
WHERE lower(employee."status") = 'active'
  AND lower(coalesce(employee."department", '')) NOT LIKE '%canada%'
  AND lower(coalesce(employee."department", ''))
      !~ '(^|[^a-z])(us|usa|u[.]s[.]?|united states)([^a-z]|$)'
ON CONFLICT ("tenant_id", "employee_id", "effective_from") DO UPDATE SET
  "shift_id" = EXCLUDED."shift_id",
  "effective_to" = NULL,
  "updated_at" = now();
--> statement-breakpoint

-- Attach stored Oybek punches when one, and only one, employee owns the normalized Face ID.
WITH employee_faces AS (
  SELECT
    "tenant_id",
    CASE
      WHEN btrim("face_id") ~ '^[0-9]+$'
        THEN coalesce(nullif(ltrim(btrim("face_id"), '0'), ''), '0')
      ELSE lower(btrim("face_id"))
    END AS normalized_face_id,
    min("id") AS employee_id,
    count(*) AS matches
  FROM "hr_employees"
  WHERE "face_id" IS NOT NULL
    AND btrim("face_id") <> ''
  GROUP BY 1, 2
)
UPDATE "hr_attendance_punches" punch
SET "employee_id" = employee_faces.employee_id
FROM employee_faces
WHERE punch."tenant_id" = employee_faces."tenant_id"
  AND punch."employee_id" IS NULL
  AND punch."door_name" ILIKE '%Oybek%'
  AND employee_faces.matches = 1
  AND (
    CASE
      WHEN btrim(punch."face_id") ~ '^[0-9]+$'
        THEN coalesce(nullif(ltrim(btrim(punch."face_id"), '0'), ''), '0')
      ELSE lower(btrim(punch."face_id"))
    END
  ) = employee_faces.normalized_face_id;
--> statement-breakpoint

-- Re-bucket already stored, mapped Oybek events using the overnight shift's Tashkent work date.
UPDATE "hr_attendance_punches" punch
SET "work_date" = CASE
  WHEN (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::time < TIME '03:00'
    THEN (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::date - 1
  ELSE (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::date
END
FROM "hr_attendance_shift_assignments" assignment
JOIN "hr_attendance_shifts" shift
  ON shift."id" = assignment."shift_id"
 AND shift."tenant_id" = assignment."tenant_id"
WHERE punch."tenant_id" = assignment."tenant_id"
  AND punch."employee_id" = assignment."employee_id"
  AND punch."door_name" ILIKE '%Oybek%'
  AND shift."name" = 'UZB Tashkent · Oybek';
