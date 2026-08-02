-- 0092: native comms core — threads, tickets, routing, escalations, settings.
--
-- Replaces the Zoho Desk dependency. Design notes worth keeping next to the DDL:
--   * One thread substrate carries tickets, requests, escalations and DMs, so there is a single
--     message write path, attachment join, read-state mechanism and realtime topic family.
--   * A client ticket is tied to carrier_id + company_name and NOTHING else. There is no contact
--     table: clients live in the DWH as octane.dim_company, so those two columns are a snapshot.
--   * An escalation is PERSONAL — keyed on the requester's Zoho identity, never a carrier. Enforced
--     by a CHECK, not a convention.
--   * Ticket status is lifecycle only. Escalation position is `escalation_level` (1..4). In Desk the
--     ladder IS the status, which is why "is this open?" and "how far up is it?" collapse into one
--     question there.
--
-- Hand-written: meta/ snapshots stop at 0024 while the journal runs past 0082, so drizzle-kit
-- generate would diff against a long-stale snapshot.

-- Human-readable ticket numbers: one global sequence, formatted per kind (T-/R-/E-) at insert time.
-- Globally monotone rather than per-tenant contiguous; a rolled-back transaction leaves a gap, which
-- is invisible in a ticket number. The alternative (a per-tenant counter row) would serialise every
-- create in the tenant on one row for a property nobody needs.
CREATE SEQUENCE IF NOT EXISTS mytrion_comms_number_seq AS bigint;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_threads (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  kind text NOT NULL,
  visibility text NOT NULL,
  department text,
  subject text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'open',
  dm_key text,
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_id text,
  last_message_seq integer NOT NULL DEFAULT 0,
  last_message_preview text,
  last_message_author_zoho_user_id text,
  created_by_zoho_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_threads_kind_chk
    CHECK (kind IN ('ticket', 'request', 'escalation', 'dm')),
  CONSTRAINT mytrion_threads_visibility_chk
    CHECK (visibility IN ('participants', 'department')),
  CONSTRAINT mytrion_threads_state_chk CHECK (state IN ('open', 'archived')),
  -- The DM-leak firewall. A code path that tries to make a private chat department-visible fails at
  -- the database rather than in review.
  CONSTRAINT mytrion_threads_dm_chk CHECK (
    kind <> 'dm'
    OR (visibility = 'participants' AND department IS NULL AND dm_key IS NOT NULL)
  ),
  CONSTRAINT mytrion_threads_nondm_chk CHECK (kind = 'dm' OR dm_key IS NULL),
  CONSTRAINT mytrion_threads_dept_chk
    CHECK (visibility <> 'department' OR department IS NOT NULL),
  CONSTRAINT mytrion_threads_counts_chk
    CHECK (message_count >= 0 AND last_message_seq >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mytrion_threads_tenant_dept_recent_idx
  ON mytrion_threads (tenant_id, department, visibility, last_message_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_threads_tenant_kind_recent_idx
  ON mytrion_threads (tenant_id, kind, last_message_at DESC);
--> statement-breakpoint
-- Partial: only DMs occupy it, so "open the DM with Bob" is a race-free upsert.
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_threads_tenant_dm_uk
  ON mytrion_threads (tenant_id, dm_key) WHERE dm_key IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_thread_messages (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  thread_id text NOT NULL,
  thread_kind text NOT NULL,
  seq integer NOT NULL,
  kind text NOT NULL DEFAULT 'message',
  body text NOT NULL,
  body_format text NOT NULL DEFAULT 'text',
  author_kind text NOT NULL,
  author_zoho_user_id text,
  author_carrier_id text,
  author_name text,
  is_internal boolean NOT NULL DEFAULT false,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  system_event text,
  detail jsonb,
  edited_at timestamptz,
  redacted_at timestamptz,
  redacted_by_zoho_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_thread_messages_kind_chk CHECK (kind IN ('message', 'note', 'system')),
  CONSTRAINT mytrion_thread_messages_format_chk CHECK (body_format IN ('text', 'markdown')),
  CONSTRAINT mytrion_thread_messages_author_kind_chk
    CHECK (author_kind IN ('worker', 'carrier', 'system')),
  -- A worker message must name its worker, and only a worker message may.
  CONSTRAINT mytrion_thread_messages_author_chk
    CHECK ((author_kind = 'worker') = (author_zoho_user_id IS NOT NULL)),
  -- An "internal note" is meaningless in a 1:1 chat and would be a UI trap.
  CONSTRAINT mytrion_thread_messages_dm_internal_chk
    CHECK (thread_kind <> 'dm' OR is_internal = false),
  CONSTRAINT mytrion_thread_messages_seq_chk CHECK (seq > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_thread_messages_thread_seq_uk
  ON mytrion_thread_messages (tenant_id, thread_id, seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_thread_messages_thread_time_idx
  ON mytrion_thread_messages (tenant_id, thread_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_thread_messages_tenant_author_idx
  ON mytrion_thread_messages (tenant_id, author_zoho_user_id, created_at DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Members (participants AND read state, merged)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_thread_members (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  thread_id text NOT NULL,
  member_kind text NOT NULL,
  member_key text NOT NULL,
  member_name text,
  role text NOT NULL DEFAULT 'participant',
  state text NOT NULL DEFAULT 'active',
  notify text NOT NULL DEFAULT 'all',
  added_by_zoho_user_id text,
  last_read_seq integer NOT NULL DEFAULT 0,
  last_read_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_thread_members_kind_chk CHECK (member_kind IN ('worker', 'carrier')),
  -- A blank key would make every unlinked identity share one membership row.
  CONSTRAINT mytrion_thread_members_key_chk CHECK (member_key <> ''),
  CONSTRAINT mytrion_thread_members_role_chk
    CHECK (role IN ('requester', 'assignee', 'watcher', 'approver', 'participant')),
  CONSTRAINT mytrion_thread_members_state_chk CHECK (state IN ('active', 'left', 'muted')),
  CONSTRAINT mytrion_thread_members_notify_chk CHECK (notify IN ('all', 'mentions', 'none')),
  CONSTRAINT mytrion_thread_members_read_chk CHECK (last_read_seq >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_thread_members_thread_member_uk
  ON mytrion_thread_members (tenant_id, thread_id, member_kind, member_key);
--> statement-breakpoint
-- THE "my queue / my chats with unread counts" index: single-table, no join.
CREATE INDEX IF NOT EXISTS mytrion_thread_members_inbox_idx
  ON mytrion_thread_members (tenant_id, member_kind, member_key, state, last_message_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_thread_members_thread_idx
  ON mytrion_thread_members (tenant_id, thread_id, state);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Attachments (one of the two events the live widget subscribes to)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_thread_attachments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  thread_id text NOT NULL,
  message_id text,
  file_asset_id text NOT NULL,
  storage text NOT NULL DEFAULT 's3',
  name text NOT NULL,
  mime text,
  size_bytes integer,
  external_url text,
  is_internal boolean NOT NULL DEFAULT false,
  uploaded_by_zoho_user_id text,
  uploaded_by_carrier_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_thread_attachments_storage_chk CHECK (storage IN ('s3', 'dropbox')),
  CONSTRAINT mytrion_thread_attachments_size_chk CHECK (size_bytes IS NULL OR size_bytes >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mytrion_thread_attachments_thread_idx
  ON mytrion_thread_attachments (tenant_id, thread_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_thread_attachments_message_idx
  ON mytrion_thread_attachments (tenant_id, message_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_thread_attachments_file_idx
  ON mytrion_thread_attachments (tenant_id, file_asset_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Ticket type / escalation reason catalog
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_ticket_types (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'ticket',
  target_department text,
  "group" text,
  default_priority text,
  sla_hours integer,
  default_assignee_zoho_user_id text,
  requestable boolean NOT NULL DEFAULT false,
  requires_carrier boolean NOT NULL DEFAULT false,
  requires_card boolean NOT NULL DEFAULT false,
  automation_key text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_ticket_types_kind_chk CHECK (kind IN ('ticket', 'escalation_reason')),
  CONSTRAINT mytrion_ticket_types_code_chk CHECK (code <> ''),
  CONSTRAINT mytrion_ticket_types_priority_chk
    CHECK (default_priority IS NULL
           OR default_priority IN ('low', 'medium', 'high', 'critical')),
  -- A ticket type must name the queue it lands in; a reason routes by assignee instead.
  CONSTRAINT mytrion_ticket_types_target_chk
    CHECK (kind <> 'ticket' OR target_department IS NOT NULL)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_ticket_types_tenant_code_uk
  ON mytrion_ticket_types (tenant_id, code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_ticket_types_picker_idx
  ON mytrion_ticket_types (tenant_id, kind, active, sort_order);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_ticket_types_dept_idx
  ON mytrion_ticket_types (tenant_id, target_department, active);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_tickets (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  thread_id text NOT NULL,
  number text NOT NULL,
  kind text NOT NULL,
  ticket_type_id text,
  ticket_type_code text,
  ticket_type_label text,
  target_department text,
  source_department text,
  source_mytrion text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  substatus text,
  requester_kind text NOT NULL,
  requester_zoho_user_id text,
  requester_carrier_id text,
  requester_name text NOT NULL,
  assignee_zoho_user_id text,
  assignee_name text,
  assigned_at timestamptz,
  assignment_reason text,
  carrier_id text,
  company_name text,
  application_id text,
  crm_deal_id text,
  card_number text,
  card_last4 text,
  channel text NOT NULL DEFAULT 'web',
  source text NOT NULL DEFAULT 'worker',
  sla_hours integer,
  due_at timestamptz,
  first_response_due_at timestamptz,
  first_response_at timestamptz,
  breached_at timestamptz,
  escalation_id text,
  escalation_level integer,
  escalation_level_label text,
  resolved_at timestamptz,
  resolved_by_zoho_user_id text,
  closed_at timestamptz,
  reopened_at timestamptz,
  cancelled_at timestamptz,
  close_reason text,
  version integer NOT NULL DEFAULT 1,
  idempotency_key text,
  created_by_zoho_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_tickets_kind_chk CHECK (kind IN ('ticket', 'request', 'escalation')),
  CONSTRAINT mytrion_tickets_status_chk CHECK (status IN (
    'open', 'in_progress', 'pending_requester', 'on_hold',
    'escalated', 'resolved', 'closed', 'cancelled')),
  CONSTRAINT mytrion_tickets_priority_chk
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT mytrion_tickets_requester_kind_chk CHECK (requester_kind IN ('worker', 'carrier')),
  -- Exactly one requester identity, matching its kind. No contact record exists in this system: a
  -- carrier IS the client, keyed by carrier_id.
  CONSTRAINT mytrion_tickets_requester_chk CHECK (
    (requester_kind = 'worker'
      AND requester_zoho_user_id IS NOT NULL AND requester_carrier_id IS NULL)
    OR (requester_kind = 'carrier'
      AND requester_carrier_id IS NOT NULL AND requester_zoho_user_id IS NULL)
  ),
  -- Escalations are PERSONAL: tied to a Zoho identity, never to a client. Structural, not a habit.
  CONSTRAINT mytrion_tickets_escalation_personal_chk CHECK (
    kind <> 'escalation'
    OR (carrier_id IS NULL AND company_name IS NULL AND requester_kind = 'worker')
  ),
  CONSTRAINT mytrion_tickets_escalation_level_chk
    CHECK (escalation_level IS NULL OR escalation_level BETWEEN 1 AND 4),
  CONSTRAINT mytrion_tickets_assignment_reason_chk CHECK (
    assignment_reason IS NULL
    OR assignment_reason IN ('auto', 'claimed', 'manual', 'default')
  ),
  CONSTRAINT mytrion_tickets_channel_chk CHECK (channel IN (
    'web', 'mini_app', 'telegram', 'email', 'phone', 'automation')),
  CONSTRAINT mytrion_tickets_source_chk
    CHECK (source IN ('worker', 'mini_app', 'automation', 'webhook')),
  CONSTRAINT mytrion_tickets_version_chk CHECK (version > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_tickets_tenant_number_uk
  ON mytrion_tickets (tenant_id, number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_tickets_tenant_thread_uk
  ON mytrion_tickets (tenant_id, thread_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_tickets_queue_idx
  ON mytrion_tickets (tenant_id, target_department, status, priority, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_tickets_assignee_idx
  ON mytrion_tickets (tenant_id, assignee_zoho_user_id, status, due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_tickets_requester_idx
  ON mytrion_tickets (tenant_id, requester_zoho_user_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_tickets_carrier_idx
  ON mytrion_tickets (tenant_id, carrier_id, created_at DESC);
--> statement-breakpoint
-- SLA sweeper: only rows that can still breach.
CREATE INDEX IF NOT EXISTS mytrion_tickets_due_idx
  ON mytrion_tickets (tenant_id, status, due_at) WHERE due_at IS NOT NULL;
--> statement-breakpoint
-- The unassigned queue + the deferred-assignment sweep when an agent comes online.
CREATE INDEX IF NOT EXISTS mytrion_tickets_unassigned_idx
  ON mytrion_tickets (tenant_id, target_department, created_at)
  WHERE assignee_zoho_user_id IS NULL AND status = 'open';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_tickets_idem_uk
  ON mytrion_tickets (tenant_id, source, idempotency_key) WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Ticket event journal (append-only)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_ticket_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  ticket_id text NOT NULL,
  thread_id text,
  event_type text NOT NULL,
  actor_zoho_user_id text,
  actor_name text,
  from_status text,
  to_status text,
  detail text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mytrion_ticket_events_ticket_time_idx
  ON mytrion_ticket_events (tenant_id, ticket_id, occurred_at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Round-robin pool + per-department routing config
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_department_agents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  department text NOT NULL,
  zoho_user_id text NOT NULL,
  display_name text,
  active boolean NOT NULL DEFAULT true,
  accepts_new boolean NOT NULL DEFAULT true,
  max_open integer,
  sort_order integer NOT NULL DEFAULT 0,
  last_assigned_at timestamptz,
  assigned_count integer NOT NULL DEFAULT 0,
  added_by_zoho_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_department_agents_actor_chk CHECK (zoho_user_id <> ''),
  CONSTRAINT mytrion_department_agents_cap_chk CHECK (max_open IS NULL OR max_open > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_department_agents_dept_user_uk
  ON mytrion_department_agents (tenant_id, department, zoho_user_id);
--> statement-breakpoint
-- THE selector index: eligible pool members, least-recently-assigned first (NULLs first).
CREATE INDEX IF NOT EXISTS mytrion_department_agents_pool_idx
  ON mytrion_department_agents (tenant_id, department, active, accepts_new, last_assigned_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_department_agents_agent_idx
  ON mytrion_department_agents (tenant_id, zoho_user_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mytrion_department_config (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  department text NOT NULL,
  ticket_assignment_strategy text NOT NULL DEFAULT 'round_robin',
  require_online boolean NOT NULL DEFAULT true,
  default_assignee_zoho_user_id text,
  manager_zoho_user_id text,
  manager_name text,
  accepts_tickets boolean NOT NULL DEFAULT true,
  accepts_escalations boolean NOT NULL DEFAULT true,
  sla_hours_override integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_department_config_strategy_chk
    CHECK (ticket_assignment_strategy IN ('round_robin', 'least_open', 'manual'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_department_config_dept_uk
  ON mytrion_department_config (tenant_id, department);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Escalations + hop chain
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_escalations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  thread_id text NOT NULL,
  ticket_id text NOT NULL,
  reason_type_id text,
  reason_code text,
  reason_label text,
  requester_zoho_user_id text NOT NULL,
  requester_name text NOT NULL,
  requester_department text,
  status text NOT NULL DEFAULT 'pending',
  current_level integer NOT NULL DEFAULT 2,
  current_hop_index integer NOT NULL DEFAULT 1,
  current_department text,
  current_assignee_zoho_user_id text,
  current_assignee_name text,
  hop_due_at timestamptz,
  resolution_comment text,
  resolved_by_zoho_user_id text,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_escalations_status_chk
    CHECK (status IN ('pending', 'resolved', 'rejected', 'withdrawn', 'expired')),
  CONSTRAINT mytrion_escalations_level_chk CHECK (current_level BETWEEN 1 AND 4),
  CONSTRAINT mytrion_escalations_hop_chk CHECK (current_hop_index > 0),
  CONSTRAINT mytrion_escalations_requester_chk CHECK (requester_zoho_user_id <> ''),
  CONSTRAINT mytrion_escalations_version_chk CHECK (version > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_escalations_ticket_uk
  ON mytrion_escalations (tenant_id, ticket_id);
--> statement-breakpoint
-- "Escalations waiting on me".
CREATE INDEX IF NOT EXISTS mytrion_escalations_inbox_idx
  ON mytrion_escalations (tenant_id, current_assignee_zoho_user_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_escalations_requester_idx
  ON mytrion_escalations (tenant_id, requester_zoho_user_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_escalations_dept_idx
  ON mytrion_escalations (tenant_id, current_department, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_escalations_due_idx
  ON mytrion_escalations (tenant_id, status, hop_due_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mytrion_escalation_hops (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  escalation_id text NOT NULL,
  hop_index integer NOT NULL,
  level integer NOT NULL,
  level_label text NOT NULL,
  department text,
  assignee_zoho_user_id text,
  assignee_name text,
  routing_source text NOT NULL,
  skip_reason text,
  handoff_note text,
  decided_by_zoho_user_id text,
  decision text,
  status text NOT NULL DEFAULT 'pending',
  decision_comment text,
  sla_hours integer,
  due_at timestamptz,
  opened_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT mytrion_escalation_hops_hop_chk CHECK (hop_index > 0),
  CONSTRAINT mytrion_escalation_hops_level_chk CHECK (level BETWEEN 1 AND 4),
  CONSTRAINT mytrion_escalation_hops_routing_chk CHECK (routing_source IN (
    'requester', 'reason_default', 'department_manager', 'c_level', 'manual', 'unresolved')),
  CONSTRAINT mytrion_escalation_hops_status_chk CHECK (status IN (
    'pending', 'escalated_up', 'handed_off', 'resolved', 'rejected', 'skipped')),
  CONSTRAINT mytrion_escalation_hops_decision_chk CHECK (decision IS NULL OR decision IN (
    'raised', 'escalated_up', 'handed_off', 'reassigned',
    'resolved', 'rejected', 'withdrawn', 'expired'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_escalation_hops_hop_uk
  ON mytrion_escalation_hops (tenant_id, escalation_id, hop_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_escalation_hops_chain_idx
  ON mytrion_escalation_hops (tenant_id, escalation_id, hop_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_escalation_hops_dept_level_idx
  ON mytrion_escalation_hops (tenant_id, department, level, status);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Settings (one row per tenant)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mytrion_comms_settings (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  sla_hours_by_priority jsonb NOT NULL
    DEFAULT '{"low":72,"medium":24,"high":4,"critical":4}'::jsonb,
  first_response_hours_by_priority jsonb NOT NULL
    DEFAULT '{"low":24,"medium":8,"high":2,"critical":1}'::jsonb,
  c_level_zoho_user_id text,
  c_level_name text,
  dm_enabled boolean NOT NULL DEFAULT false,
  dm_admin_read_enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'Asia/Tashkent',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_comms_settings_tenant_uk
  ON mytrion_comms_settings (tenant_id);
--> statement-breakpoint

-- One settings row per existing tenant. Deterministic id so re-running is a no-op.
INSERT INTO mytrion_comms_settings (id, tenant_id)
SELECT 'mcs_' || substr(md5(t.id), 1, 20), t.id FROM tenants t
ON CONFLICT (tenant_id) DO NOTHING;
