-- Salesforce-style permission sets: named, reusable, additive grants assigned to users.
--
-- Hand-written rather than generated. `drizzle-kit generate` diffs against meta/*_snapshot.json,
-- and those snapshots have drifted from what is actually applied — running it here emitted 388
-- lines re-creating the comms, knowledge and ticketing tables that already exist, and none of the
-- two tables below. Idempotent DDL per CLAUDE.md, so this is safe on a fresh DB and on prod.

CREATE TABLE IF NOT EXISTS mytrion_permission_sets (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL,
  name                  text NOT NULL,
  -- trim+lowercase(name); the uniqueness key, same convention as profile_key / role_key.
  key                   text NOT NULL,
  description           text,
  -- Mytrions this set GRANTS. Unioned with every other layer, never subtracted.
  allowed_mytrions      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- read|full per granted Mytrion. Enforced for real: reaches TenantContext.mytrionAccessModes.
  mytrion_access_modes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Per-Mytrion tab whitelist. A Mytrion ABSENT is UNSCOPED — every tab, including ones added
  -- later. Only an explicitly present array scopes, which is what keeps a new tab from silently
  -- disappearing for everyone on rollout.
  tab_grants            jsonb NOT NULL DEFAULT '{}'::jsonb,
  active                boolean NOT NULL DEFAULT true,
  created_by_zoho_user_id text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mytrion_permission_sets_tenant_key_uk
  ON mytrion_permission_sets (tenant_id, key);
CREATE INDEX IF NOT EXISTS mytrion_permission_sets_tenant_idx
  ON mytrion_permission_sets (tenant_id);

CREATE TABLE IF NOT EXISTS mytrion_permission_set_assignments (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL,
  -- No FK — house rule. Orphans are tolerated and skipped by the resolver.
  permission_set_id     text NOT NULL,
  zoho_user_id          text NOT NULL,
  -- Denormalized CRM snapshot, display + audit only. The grant is keyed on zoho_user_id.
  user_name             text,
  email                 text,
  assigned_by_zoho_user_id text,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mps_assignments_set_user_uk
  ON mytrion_permission_set_assignments (tenant_id, permission_set_id, zoho_user_id);
-- "Which sets does this user hold" — the per-request resolve path.
CREATE INDEX IF NOT EXISTS mps_assignments_user_idx
  ON mytrion_permission_set_assignments (tenant_id, zoho_user_id);
-- "Who holds this set" — the admin listing and targeted cache invalidation.
CREATE INDEX IF NOT EXISTS mps_assignments_set_idx
  ON mytrion_permission_set_assignments (tenant_id, permission_set_id);
