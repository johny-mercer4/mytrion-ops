-- Mytrion-owned attendance: shifts, assignments, punches (Hikvision FaceID webhook).
-- Hand-written IF NOT EXISTS — same drizzle snapshot collision reason as recent HR migrations.

CREATE TABLE IF NOT EXISTS "hr_attendance_shifts" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "name" text NOT NULL,
  "timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
  "start_local" text NOT NULL,
  "end_local" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_attendance_shifts_tenant_name_uk"
  ON "hr_attendance_shifts" ("tenant_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_attendance_shifts_tenant_idx"
  ON "hr_attendance_shifts" ("tenant_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hr_attendance_shift_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "employee_id" text NOT NULL,
  "shift_id" text NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_attendance_shift_asg_tenant_emp_from_uk"
  ON "hr_attendance_shift_assignments" ("tenant_id","employee_id","effective_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_attendance_shift_asg_tenant_emp_idx"
  ON "hr_attendance_shift_assignments" ("tenant_id","employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_attendance_shift_asg_tenant_shift_idx"
  ON "hr_attendance_shift_assignments" ("tenant_id","shift_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hr_attendance_punches" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "employee_id" text,
  "face_id" text NOT NULL,
  "kind" text NOT NULL,
  "punched_at" timestamp with time zone NOT NULL,
  "work_date" date NOT NULL,
  "source" text DEFAULT 'hikvision' NOT NULL,
  "door_name" text,
  "note" text,
  "raw_event" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_attendance_punches_dedup_uk"
  ON "hr_attendance_punches" ("tenant_id","face_id","kind","punched_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_attendance_punches_tenant_emp_date_idx"
  ON "hr_attendance_punches" ("tenant_id","employee_id","work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_attendance_punches_tenant_date_idx"
  ON "hr_attendance_punches" ("tenant_id","work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_attendance_punches_tenant_face_idx"
  ON "hr_attendance_punches" ("tenant_id","face_id");
