-- 0089: routing config is keyed on OUR OWN hr_departments, not on a hardcoded slug list.
--
-- Until now `mytrion_department_config.department` was a free-text slug seeded from KNOWN_DEPARTMENTS, so
-- the admin screen offered a list that lived in code and had no connection to the real org chart. The
-- decision is that departments come from `hr_departments` (our own table, synced from Zoho People) and
-- people come from `hr_employees` → Zoho user ids.
--
-- Why BOTH a link and the slug, rather than replacing one with the other:
--   * `department` stays the ROUTING KEY. It is what `mytrion_threads.department` stores, what the
--     `comms:queue:<department>` WebSocket topic is built from (regex `^[a-z][a-z0-9-]{1,40}$`), and what
--     `TenantContext.departments` holds for RBAC. Swapping in an `hrd_…` id would break the read gate, the
--     topic grammar and every existing access grant at once.
--   * `hr_department_id` makes the ORG identity explicit instead of matching on a slugified name. A name
--     match would silently orphan a department's whole routing config the first time HR renames it —
--     exactly the class of heuristic link this schema avoids elsewhere (see the note on
--     `hr_employees.zoho_user_id` being chosen explicitly rather than derived).
--
-- Nullable on purpose: the ten rows 0087 seeded have no HR link yet, and an unlinked row must keep routing
-- rather than fail. The admin screen surfaces unlinked rows so they can be mapped.

ALTER TABLE mytrion_department_config ADD COLUMN IF NOT EXISTS hr_department_id text;
--> statement-breakpoint

-- Display name, snapshotted from hr_departments.name. Held here so a queue, a picker and an escalation
-- chain can render "Billing & Accounting" without joining HR on every read — and so a department that is
-- later deleted from HR still renders as something in historical escalations.
ALTER TABLE mytrion_department_config ADD COLUMN IF NOT EXISTS label text;
--> statement-breakpoint

-- One config row per HR department. Partial, because the unlinked seeded rows are all NULL and NULLs are
-- not distinct enough for a plain unique index to allow more than one of them.
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_department_config_hr_uk
  ON mytrion_department_config (tenant_id, hr_department_id)
  WHERE hr_department_id IS NOT NULL;
--> statement-breakpoint

-- Best-effort backfill for the rows 0087 seeded: match a slugified hr_departments.name against the
-- existing slug. Deliberately a ONE-OFF convenience, not a live fallback — after this runs the link is
-- explicit data an admin owns, and nothing in the code re-derives it.
--
-- `regexp_replace(..., 'g')` collapses every run of non-alphanumerics to a single dash, so
-- 'Billing & Accounting' → 'billing-accounting' and 'Customer Service' → 'customer-service'.
--
-- (The routing-source widening below is part of the same change: an escalation is now opened AGAINST a
-- department, so its first hop needs a provenance value that says so.)
UPDATE mytrion_department_config c
   SET hr_department_id = d.id,
       label = d.name
  FROM hr_departments d
 WHERE d.tenant_id = c.tenant_id
   AND c.hr_department_id IS NULL
   AND trim(both '-' from regexp_replace(lower(d.name), '[^a-z0-9]+', '-', 'g')) = c.department
   -- Skip a name that slugifies to the same value for two HR rows; an ambiguous match must be resolved by
   -- a human in Mytrion Admin, not guessed here.
   AND (
     SELECT count(*) FROM hr_departments d2
      WHERE d2.tenant_id = c.tenant_id
        AND trim(both '-' from regexp_replace(lower(d2.name), '[^a-z0-9]+', '-', 'g')) = c.department
   ) = 1;
--> statement-breakpoint

-- Escalations are now OPENED AGAINST a department, so level 2 resolves from that department's nominated
-- agent (or its roster) rather than from the reason. `routing_source` exists to make a chain explainable —
-- "who decided this goes to her, and on what basis" — so that path needs its own value instead of being
-- filed under `reason_default`, which would claim a reason chose someone it never named.
ALTER TABLE mytrion_escalation_hops
  DROP CONSTRAINT IF EXISTS mytrion_escalation_hops_routing_chk;
--> statement-breakpoint

ALTER TABLE mytrion_escalation_hops
  ADD CONSTRAINT mytrion_escalation_hops_routing_chk CHECK (routing_source IN (
    'requester',
    'reason_default',
    -- The target department's nominated default assignee.
    'department_default',
    -- Its least-recently-assigned roster member, when no default is nominated.
    'department_pool',
    'department_manager',
    'c_level',
    'manual',
    'unresolved'));
