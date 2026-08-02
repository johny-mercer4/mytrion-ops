CREATE TABLE IF NOT EXISTS "maintenance_case_history" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL,
  "action" text NOT NULL,
  "changed_by_user_id" text,
  "changed_by_name" text,
  "changes" jsonb NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_case_history_case_id_fk"
    FOREIGN KEY ("case_id") REFERENCES "maintenance_cases"("id") ON DELETE CASCADE,
  CONSTRAINT "maintenance_case_history_action_check"
    CHECK ("action" IN ('created', 'updated'))
);

CREATE INDEX IF NOT EXISTS "maintenance_case_history_case_idx"
  ON "maintenance_case_history" ("case_id", "changed_at");
