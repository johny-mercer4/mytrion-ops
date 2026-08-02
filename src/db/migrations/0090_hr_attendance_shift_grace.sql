-- Keep overnight overtime exits attached to the shift they close. The 19:00–03:00 Ganga shift
-- commonly ends after 03:00; without a grace window a 05:00 checkout lands on the next work date
-- and appears as an unmatched scan.

WITH corrected AS (
  SELECT
    punch."id",
    CASE
      WHEN shift."end_local"::time <= shift."start_local"::time
       AND (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::time
           < least(
               shift."start_local"::time,
               (shift."end_local"::time + interval '4 hours')::time
             )
        THEN (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::date - 1
      ELSE (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::date
    END AS work_date
  FROM "hr_attendance_punches" punch
  JOIN LATERAL (
    SELECT configured."start_local", configured."end_local"
    FROM "hr_attendance_shift_assignments" assignment
    JOIN "hr_attendance_shifts" configured
      ON configured."id" = assignment."shift_id"
     AND configured."tenant_id" = assignment."tenant_id"
     AND configured."is_active" = true
    WHERE assignment."tenant_id" = punch."tenant_id"
      AND assignment."employee_id" = punch."employee_id"
      AND assignment."effective_from"
          <= (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::date
      AND (
        assignment."effective_to" IS NULL
        OR assignment."effective_to"
           >= (punch."punched_at" AT TIME ZONE 'Asia/Tashkent')::date
              - CASE
                  WHEN configured."end_local"::time <= configured."start_local"::time THEN 1
                  ELSE 0
                END
      )
    ORDER BY assignment."effective_from" DESC
    LIMIT 1
  ) shift ON true
  WHERE punch."employee_id" IS NOT NULL
    AND punch."door_name" ILIKE '%Ganga%'
)
UPDATE "hr_attendance_punches" punch
SET "work_date" = corrected.work_date
FROM corrected
WHERE punch."id" = corrected."id"
  AND punch."work_date" IS DISTINCT FROM corrected.work_date;
