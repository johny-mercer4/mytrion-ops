-- Correction: Ganga readers are authoritative; Oybek readers must never contribute attendance.
-- Preserve the existing shift/assignments by renaming the seeded shift in place.

UPDATE "hr_attendance_shifts"
SET
  "name" = 'UZB Tashkent · Ganga',
  "updated_at" = now()
WHERE "name" = 'UZB Tashkent · Oybek';
--> statement-breakpoint

-- These were ingested only during the brief incorrect Oybek policy. The source payload remains
-- available in request/audit logs, but it must not exist as an attendance punch or affect HR totals.
DELETE FROM "hr_attendance_punches"
WHERE "source" = 'hikvision'
  AND "door_name" ILIKE '%Oybek%';
--> statement-breakpoint

-- Attach stored Ganga punches when one, and only one, employee owns the normalized Face ID.
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
  AND punch."door_name" ILIKE '%Ganga%'
  AND employee_faces.matches = 1
  AND (
    CASE
      WHEN btrim(punch."face_id") ~ '^[0-9]+$'
        THEN coalesce(nullif(ltrim(btrim(punch."face_id"), '0'), ''), '0')
      ELSE lower(btrim(punch."face_id"))
    END
  ) = employee_faces.normalized_face_id;
--> statement-breakpoint

-- Re-bucket mapped Ganga events using the overnight Tashkent shift.
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
  AND punch."door_name" ILIKE '%Ganga%'
  AND shift."name" = 'UZB Tashkent · Ganga';
