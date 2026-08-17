-- Verification Mytrion cases: Zoho Deal intake owned in Octane Postgres.
-- Hand-written (drizzle-kit snapshot is stale — see 0116). Idempotent DDL.

CREATE TABLE IF NOT EXISTS verification_cases (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  zoho_deal_id text NOT NULL,
  zoho_application_id text,
  carrier_id text,
  request_id text,
  company_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  cell text,
  address text,
  city text,
  state text,
  zip text,
  date_of_birth text,
  dot text,
  mc text,
  truck_count text,
  business_type text,
  zoho_stage text,
  application_status text,
  application_date text,
  credit_score text,
  creditsafe_grade text,
  zoho_owner_id text,
  zoho_owner_name text,
  zoho_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  distribute_type text NOT NULL DEFAULT 'shared',
  owner_zoho_user_id text NOT NULL,
  owner_name text NOT NULL,
  matched_snapshot_id text,
  matched_via text,
  carrier_operating_status text,
  carrier_units text,
  carrier_address text,
  carrier_dot text,
  carrier_phone text,
  carrier_email text,
  status text NOT NULL DEFAULT 'new',
  current_stage text,
  stages_done integer NOT NULL DEFAULT 0,
  stages_total integer NOT NULL DEFAULT 10,
  last_decision text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_cases_tenant_deal_uq
  ON verification_cases (tenant_id, zoho_deal_id);

CREATE INDEX IF NOT EXISTS verification_cases_tenant_status_idx
  ON verification_cases (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS verification_cases_tenant_owner_idx
  ON verification_cases (tenant_id, owner_zoho_user_id);

CREATE TABLE IF NOT EXISTS verification_case_stages (
  id text PRIMARY KEY NOT NULL,
  tenant_id text NOT NULL,
  case_id text NOT NULL,
  stage_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  ran_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_case_stages_tenant_case_stage_uq
  ON verification_case_stages (tenant_id, case_id, stage_id);

CREATE INDEX IF NOT EXISTS verification_case_stages_tenant_case_idx
  ON verification_case_stages (tenant_id, case_id);

CREATE TABLE IF NOT EXISTS verification_ingest_state (
  tenant_id text PRIMARY KEY NOT NULL,
  poll_deal_date_watermark text NOT NULL,
  last_run_at timestamptz,
  last_created integer NOT NULL DEFAULT 0,
  last_skipped integer NOT NULL DEFAULT 0,
  last_failed integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_ingest_state_watermark_idx
  ON verification_ingest_state (poll_deal_date_watermark);
