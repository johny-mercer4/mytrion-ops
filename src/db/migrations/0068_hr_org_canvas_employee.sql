-- Employee-level org canvas: a person is now a NODE on the org chart, not just a headcount number
-- inside a department box. That needs two things the table did not have.
--
-- Hand-written (not `drizzle-kit generate`) for the same reason 0067 was: `meta/0022_snapshot.json`
-- and `0023_snapshot.json` both claim 0022 as their parent, so drizzle-kit refuses to generate until
-- that baseline collision is repaired. Written idempotently (IF NOT EXISTS) so it applies cleanly to a
-- fresh DB and to one that already has these columns.

-- The manager as a STABLE ID. `reporting_to` is a display NAME, which cannot anchor a graph edge: the
-- link would break on every rename and would be ambiguous wherever two employees share a name. Drag-
-- to-reparent on the canvas writes this column.
--
-- Deliberately NOT a real FOREIGN KEY. hr_employees rows are deleted by HR admins, and an FK would
-- either block the delete or (ON DELETE CASCADE) delete that manager's whole reporting line — losing
-- people because their manager left is far worse than a dangling id, which the tree builder already
-- treats as "no manager" when the target row is missing.
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "reporting_to_employee_id" text;
--> statement-breakpoint
-- Org-canvas position once a user drags this person's node. Null = auto-layout owns the position,
-- which is what every existing row starts as. Mirrors hr_departments.canvas_x/y from 0067.
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "canvas_x" integer;
--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "canvas_y" integer;
--> statement-breakpoint
-- The canvas resolves children-by-manager for every node it draws; without this that is one sequential
-- scan per node over the whole directory.
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_manager_idx"
  ON "hr_employees" ("tenant_id","reporting_to_employee_id");
--> statement-breakpoint
-- Backfill the id link from the existing `reporting_to` names, but ONLY where the name resolves to
-- exactly one other active-or-terminated employee in the same tenant. An ambiguous name resolves to
-- nothing rather than to a guess: attaching someone to the wrong manager silently reshapes the org
-- chart, and a null simply renders them as a root until HR sets it on the canvas.
UPDATE "hr_employees" e
SET "reporting_to_employee_id" = m."id"
FROM (
  SELECT
    "tenant_id",
    lower(btrim("first_name" || ' ' || "last_name")) AS full_name,
    min("id")   AS "id",
    count(*)    AS n
  FROM "hr_employees"
  GROUP BY 1, 2
) m
WHERE e."tenant_id" = m."tenant_id"
  AND m.n = 1
  AND e."reporting_to_employee_id" IS NULL
  AND e."reporting_to" IS NOT NULL
  AND lower(btrim(e."reporting_to")) = m.full_name
  AND m."id" <> e."id";
