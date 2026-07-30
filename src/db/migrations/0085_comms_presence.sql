-- 0085: agent presence substrate for the native comms system.
--
-- Two tables, deliberately split:
--   mytrion_agent_presence      socket-liveness LEASES, one row per (tenant, agent, web instance)
--   mytrion_agent_availability  the agent's own declared readiness, durable, one row per agent
--
-- Presence lives in Postgres rather than the realtime hub's in-process Maps because ticket
-- round-robin must answer "who is online right now" in SQL, inside the same transaction as the
-- ticket insert. That is also why assignment stays correct on N web replicas with no cross-process
-- event bridge: every instance writes its own lease and the eligibility query reads all of them.
--
-- Hand-written (not drizzle-kit generated): meta/ snapshots stop at 0024 while the journal runs
-- past 0080, so `drizzle-kit generate` would diff against a long-stale snapshot.

CREATE TABLE IF NOT EXISTS mytrion_agent_presence (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  zoho_user_id text NOT NULL,
  instance_id text NOT NULL,
  socket_count integer NOT NULL DEFAULT 0,
  connected_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  departments_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_agent_presence_socket_count_chk CHECK (socket_count >= 0),
  -- A blank actor key must never be storable: it would make every "is this agent online" lookup
  -- for an unlinked employee match a real row.
  CONSTRAINT mytrion_agent_presence_actor_chk CHECK (zoho_user_id <> ''),
  CONSTRAINT mytrion_agent_presence_instance_chk CHECK (instance_id <> '')
);
--> statement-breakpoint

-- The upsert target for the batched heartbeat flush.
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_agent_presence_lease_uk
  ON mytrion_agent_presence (tenant_id, zoho_user_id, instance_id);
--> statement-breakpoint
-- Eligibility join: this agent's leases across all instances.
CREATE INDEX IF NOT EXISTS mytrion_agent_presence_agent_idx
  ON mytrion_agent_presence (tenant_id, zoho_user_id);
--> statement-breakpoint
-- Boot sweep + staleness reaping.
CREATE INDEX IF NOT EXISTS mytrion_agent_presence_stale_idx
  ON mytrion_agent_presence (tenant_id, last_seen_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mytrion_agent_availability (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  zoho_user_id text NOT NULL,
  availability text NOT NULL DEFAULT 'available',
  availability_note text,
  auto_away boolean NOT NULL DEFAULT false,
  auto_away_reason text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mytrion_agent_availability_state_chk
    CHECK (availability IN ('available', 'away', 'do_not_assign')),
  CONSTRAINT mytrion_agent_availability_actor_chk CHECK (zoho_user_id <> '')
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_agent_availability_agent_uk
  ON mytrion_agent_availability (tenant_id, zoho_user_id);
