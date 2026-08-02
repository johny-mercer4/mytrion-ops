-- 0093: escalation level 4 is a POOL (CEO + COO), not a single configured user.
--
-- 0092 put `c_level_zoho_user_id` on mytrion_comms_settings on the assumption that C-Level was one
-- person. It is two — CEO and COO — and the escalating manager picks which. A single column would
-- have been a second source of truth for the same question, so level 4 now resolves from the
-- `c-level` pool in mytrion_department_agents ('c-level' is already a KNOWN_DEPARTMENTS value).
--
-- Appended rather than amending 0092 so anyone who already applied it moves forward safely.

-- Seat label within a pool: 'CEO', 'COO', 'Team Lead', 'Senior Agent'. Load-bearing for the c-level
-- pool, where "Escalate to CEO" must be distinguishable from "Escalate to COO" in the picker.
-- Advisory only — routing always goes by zoho_user_id.
ALTER TABLE mytrion_department_agents ADD COLUMN IF NOT EXISTS role_title text;
--> statement-breakpoint

-- Drop the single-C-Level columns. Level 4 comes from the pool.
ALTER TABLE mytrion_comms_settings DROP COLUMN IF EXISTS c_level_zoho_user_id;
--> statement-breakpoint
ALTER TABLE mytrion_comms_settings DROP COLUMN IF EXISTS c_level_name;
--> statement-breakpoint

-- Seed the routing config for every department that can receive tickets or escalations, so the admin
-- screen has rows to edit rather than an empty page. Assignees and managers are left NULL on
-- purpose: they are chosen in Mytrion Admin against the HR directory, and a guessed default would
-- silently route real work to the wrong person.
--
-- 'c-level' gets strategy 'manual' because escalating to CEO vs COO is a human decision, and
-- accepts_tickets = false because nobody files a client ticket at the C-Level queue.
INSERT INTO mytrion_department_config
  (id, tenant_id, department, ticket_assignment_strategy, require_online, accepts_tickets, accepts_escalations)
SELECT 'mdcf_' || substr(md5(t.id || d.department), 1, 20),
       t.id,
       d.department,
       d.strategy,
       d.require_online,
       d.accepts_tickets,
       true
  FROM tenants t
 CROSS JOIN (VALUES
   -- Operational queues: client tickets round-robin to an available online agent.
   ('customer-service', 'round_robin', true,  true),
   ('billing',          'round_robin', true,  true),
   ('verification',     'round_robin', true,  true),
   -- Sales files tickets and receives escalations, but is not a ticket target itself.
   ('sales',            'manual',      false, false),
   -- Escalation-only destinations.
   ('retention',        'manual',      false, false),
   ('finance',          'manual',      false, false),
   ('collection',       'manual',      false, false),
   ('management',       'manual',      false, false),
   ('hr',               'manual',      false, false),
   -- Level 4. Members (CEO, COO) are added in Mytrion Admin.
   ('c-level',          'manual',      false, false)
 ) AS d(department, strategy, require_online, accepts_tickets)
ON CONFLICT (tenant_id, department) DO NOTHING;
