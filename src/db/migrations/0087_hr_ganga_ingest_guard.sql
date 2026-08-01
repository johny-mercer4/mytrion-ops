-- Defense in depth: older webhook processes may remain alive briefly during a rolling reload.
-- The application filter is authoritative, but the database must also make it impossible for a
-- stale process to persist Hikvision events from any reader other than Ganga.

DELETE FROM "hr_attendance_punches"
WHERE "source" = 'hikvision'
  AND ("door_name" IS NULL OR "door_name" NOT ILIKE '%Ganga%');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "hr_attendance_reject_non_ganga"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source" = 'hikvision'
     AND (NEW."door_name" IS NULL OR NEW."door_name" NOT ILIKE '%Ganga%') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "hr_attendance_ganga_only_trg" ON "hr_attendance_punches";
--> statement-breakpoint

CREATE TRIGGER "hr_attendance_ganga_only_trg"
BEFORE INSERT OR UPDATE OF "source", "door_name"
ON "hr_attendance_punches"
FOR EACH ROW
EXECUTE FUNCTION "hr_attendance_reject_non_ganga"();
