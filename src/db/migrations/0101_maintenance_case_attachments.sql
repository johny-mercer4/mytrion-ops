CREATE TABLE IF NOT EXISTS "maintenance_case_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL,
  "file_name" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "s3_key" text NOT NULL,
  "uploaded_by_user_id" text,
  "uploaded_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_case_attachments_case_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "maintenance_cases"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "maintenance_case_attachments_case_idx"
  ON "maintenance_case_attachments" ("case_id", "created_at");
