-- Scope manager-assigned worker tasks by Manager department desk.
ALTER TABLE "mytrion_worker_tasks"
  ADD COLUMN IF NOT EXISTS "department" text NOT NULL DEFAULT 'sales';

UPDATE "mytrion_worker_tasks"
SET "department" = 'sales'
WHERE "department" IS NULL OR trim("department") = '';

CREATE INDEX IF NOT EXISTS "mytrion_worker_tasks_tenant_dept_created_idx"
  ON "mytrion_worker_tasks" ("tenant_id", "department", "created_at");
