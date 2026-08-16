-- New-era Verification: the 10-phase new-applicant underwriting flow, owned by Mytrion Postgres.
-- Replaces dependence on the external credit_platform DB/API. `verification_cases` becomes the
-- SHARED RECORD between Sales (intake) and Verification (underwriting), like `retention_cases`.
--
-- Hand-written: verification_cases is not in drizzle.config schema (stale snapshot — see 0117/0119/0120).
-- Idempotent DDL throughout so it is safe on a fresh DB and on one that already has 0117-0120.
-- Do not apply to Render unless opted in.

-- ---------------------------------------------------------------------------------------------
-- 1. verification_cases — the shared record gains the gate, the flow axes and the intake fields.
-- ---------------------------------------------------------------------------------------------

-- THE GATE. false = intake incomplete, application shows red, Verification cannot work it.
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS verification_process boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'sales_application';
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS applicant_type text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS underwriting_route text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS phase_code text NOT NULL DEFAULT 'p1_intake';
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS status_code text NOT NULL DEFAULT 'intake_incomplete';
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS phase_changed_at timestamptz;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS ein text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS residential_address text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS business_address text;
--> statement-breakpoint
-- Full SSN / DL numbers are deliberately NOT stored. The card and licence live as Dropbox
-- documents (what the later LLM review reads); only the last 4 are searchable here.
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS ssn_last4 text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS dl_last4 text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS dl_state text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS trucks_count integer;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS fuel_cards_requested integer;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS requested_limit numeric(14,2);
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS banking_source text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS plaid_connected boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS submitted_by_zoho_user_id text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS intake_missing jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS outcome_code text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS approved_limit_amount numeric(14,2);
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS decided_by text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;
--> statement-breakpoint

-- A sales-originated application has no Zoho Deal. Drop NOT NULL and make the uniqueness partial
-- so many NULL-deal rows can coexist while a real deal id stays unique per tenant.
ALTER TABLE verification_cases
  ALTER COLUMN zoho_deal_id DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS verification_cases_tenant_deal_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS verification_cases_tenant_deal_uq
  ON verification_cases (tenant_id, zoho_deal_id)
  WHERE zoho_deal_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_cases_tenant_flow_idx
  ON verification_cases (tenant_id, status_code, phase_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_cases_tenant_submitter_idx
  ON verification_cases (tenant_id, submitted_by_zoho_user_id);
--> statement-breakpoint

-- Pre-existing Zoho-ingested rows keep their provenance.
UPDATE verification_cases SET origin = 'zoho_deal' WHERE zoho_deal_id IS NOT NULL AND origin = 'sales_application';
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 2. Lookups. New phases/statuses are INSERTs, never ALTER TYPE.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_phases (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  smallint NOT NULL,
  applies_to  text NOT NULL DEFAULT 'all',
  description text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS verification_statuses (
  code         text PRIMARY KEY,
  phase_code   text NOT NULL,
  label        text NOT NULL,
  is_terminal  boolean NOT NULL DEFAULT false,
  board_column text,
  sort_order   smallint NOT NULL DEFAULT 100
);
--> statement-breakpoint

INSERT INTO verification_phases (code, label, sort_order, applies_to, description) VALUES
  ('p1_intake',          'Application Intake',                       1,  'all',     'Zoho -> Mytrion. Applicant type, full application, documents.'),
  ('p2_identity',        'Initial Identity / Business Verification',  2,  'all',     'Cross-check identity, business and bank account ownership.'),
  ('p3_screening',       'Automated Internal Screening',              3,  'all',     'Blacklist and active-customer / duplicate checks.'),
  ('p4_authority',       'Authority & Operating Status',              4,  'carrier', 'MC/USDOT/insurance status. Skipped for individuals and owner-operators.'),
  ('p5_routing',         'Credit & Banking Review Routing',           5,  'all',     '10+ trucks review banking first; everyone else credit first.'),
  ('p6_credit_banking',  'Credit & Banking Review',                   6,  'all',     'Full credit profile plus the last three months of banking.'),
  ('p7_hard_stops',      'Financial Hard Stops',                      7,  'all',     'Negative average weekly net cash flow; no credit-bureau record.'),
  ('p8_highway',         'Carrier Operational Review (Highway)',      8,  'carrier', 'Operational credibility and consistency. Non-carriers skip.'),
  ('p9_risk_capacity',   'Risk Tier & Credit Capacity',               9,  'all',     'Risk tier, adjusted weekly capacity, recommended limit.'),
  ('p10_decision',       'Final Underwriting Decision',              10,  'all',     'Approve, manager review, deposit/prepaid, decline.')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- board_column is the SALES projection. NULL = Verification-desk-only, invisible to Sales.
INSERT INTO verification_statuses (code, phase_code, label, is_terminal, board_column, sort_order) VALUES
  ('intake_incomplete',       'p1_intake',      'Incomplete application',   false, 'draft',      10),
  ('intake_submitted',        'p1_intake',      'Submitted',                false, 'submitted',  20),
  ('in_review',               'p2_identity',    'In review',                false, 'in_review',  30),
  ('pending_docs',            'p1_intake',      'Pending documents',        false, 'needs_you',  40),
  ('manager_review',          'p10_decision',   'Manager review',           false, 'in_review',  50),
  ('additional_verification', 'p2_identity',    'Additional verification',  false, 'in_review',  60),
  ('routed_wex',              'p1_intake',      'Routed to WEX',            true,  'submitted',  70),
  ('approved',                'p10_decision',   'Approved',                 true,  'approved',   80),
  ('deposit_prepaid',         'p10_decision',   'Deposit / Prepaid',        true,  'approved',   90),
  ('declined',                'p10_decision',   'Declined',                 true,  'declined',  100),
  ('declined_customer',       'p10_decision',   'Declined by customer',     true,  'declined',  110),
  ('declined_blacklist',      'p10_decision',   'Declined + blacklisted',   true,  'declined',  120)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 3. Phase state machine + audit trail.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_case_phases (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL,
  case_id     text NOT NULL,
  phase_code  text NOT NULL,
  status      text NOT NULL DEFAULT 'not_started',
  outcome     text,
  findings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  started_at  timestamptz,
  decided_at  timestamptz,
  decided_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS verification_case_phases_tenant_case_phase_uq
  ON verification_case_phases (tenant_id, case_id, phase_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_case_phases_tenant_case_idx
  ON verification_case_phases (tenant_id, case_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS verification_case_events (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL,
  case_id            text NOT NULL,
  from_phase         text,
  to_phase           text,
  from_status        text,
  to_status          text,
  event_type         text NOT NULL,
  actor_zoho_user_id text,
  actor_name         text,
  notes              text,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_case_events_case_occurred_idx
  ON verification_case_events (tenant_id, case_id, occurred_at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 4. Intake satellites.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_case_principals (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL,
  case_id       text NOT NULL,
  full_name     text NOT NULL,
  role          text,
  ownership_pct numeric(5,2),
  date_of_birth text,
  ssn_last4     text,
  phone         text,
  email         text,
  address       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_case_principals_tenant_case_idx
  ON verification_case_principals (tenant_id, case_id);
--> statement-breakpoint

-- Deliberately separate from file_assets: that table's storage_provider has no verification
-- folder and its RBAC is shaped for agent-gateway tool files. Mirrors maintenance_case_attachments.
-- A row with status='requested' and no s3_key IS a Pending-Documents ask; requested_in_phase is
-- the return target when it is fulfilled.
CREATE TABLE IF NOT EXISTS verification_case_documents (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL,
  case_id             text NOT NULL,
  doc_type            text NOT NULL DEFAULT 'other',
  label               text,
  status              text NOT NULL DEFAULT 'received',
  requested_in_phase  text,
  file_name           text,
  mime                text,
  size_bytes          integer,
  s3_key              text,
  storage_provider    text NOT NULL DEFAULT 'dropbox_verification',
  uploaded_by_user_id text,
  uploaded_by_name    text,
  requested_by        text,
  requested_at        timestamptz,
  rejected_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_case_documents_tenant_case_idx
  ON verification_case_documents (tenant_id, case_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_case_documents_tenant_status_idx
  ON verification_case_documents (tenant_id, status);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 5. Phase 3 screening — entirely local, no external API.
-- ---------------------------------------------------------------------------------------------

-- value_hash is a normalized SHA-256 so an SSN or EIN can be matched without being stored.
CREATE TABLE IF NOT EXISTS verification_blacklist_entries (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL,
  entry_type     text NOT NULL,
  value_hash     text NOT NULL,
  value_last4    text,
  value_display  text,
  reason         text,
  source_case_id text,
  added_by       text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_blacklist_entries_lookup_idx
  ON verification_blacklist_entries (tenant_id, entry_type, value_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS verification_blacklist_entries_tenant_type_hash_uq
  ON verification_blacklist_entries (tenant_id, entry_type, value_hash);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS verification_screening_hits (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL,
  case_id               text NOT NULL,
  check_type            text NOT NULL,
  entry_type            text NOT NULL,
  matched_value_display text,
  matched_entry_id      text,
  matched_case_id       text,
  matched_case_label    text,
  verdict               text NOT NULL DEFAULT 'unverified',
  verified_by           text,
  verified_at           timestamptz,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_screening_hits_tenant_case_idx
  ON verification_screening_hits (tenant_id, case_id, check_type);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 6. Phase 6 typed reviews — these numbers gate Phase 7 and feed the Phase 9 capacity formula.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_credit_reviews (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL,
  case_id            text NOT NULL,
  credit_score       integer,
  late_payments      integer,
  collections        integer,
  utilization_pct    numeric(5,2),
  inquiries_12m      integer,
  history_months     integer,
  open_accounts      integer,
  total_debt         numeric(14,2),
  revolving_accounts integer,
  auto_loans         integer,
  mortgages          integer,
  repayment_behavior text,
  recent_trend       text,
  bureau_no_hit      boolean NOT NULL DEFAULT false,
  outcome            text,
  note               text,
  reviewed_by        text,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS verification_credit_reviews_tenant_case_uq
  ON verification_credit_reviews (tenant_id, case_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS verification_banking_reviews (
  id                         text PRIMARY KEY,
  tenant_id                  text NOT NULL,
  case_id                    text NOT NULL,
  period_start               text,
  period_end                 text,
  account_ownership_verified boolean NOT NULL DEFAULT false,
  monthly_revenue            numeric(14,2),
  weekly_revenue             numeric(14,2),
  revenue_trend              text,
  recurring_weekly_income    numeric(14,2),
  recurring_weekly_expenses  numeric(14,2),
  avg_weekly_net_cash_flow   numeric(14,2),
  avg_monthly_net_cash_flow  numeric(14,2),
  avg_daily_balance          numeric(14,2),
  ending_balance             numeric(14,2),
  minimum_balance            numeric(14,2),
  negative_balance_days      integer,
  nsf_count                  integer,
  ach_return_count           integer,
  overdraft_count            integer,
  avg_weekly_fuel_expense    numeric(14,2),
  existing_debt_payments     numeric(14,2),
  deposit_sources            jsonb NOT NULL DEFAULT '{}'::jsonb,
  major_expenses             jsonb NOT NULL DEFAULT '{}'::jsonb,
  one_time_deposits          numeric(14,2),
  unusual_transactions       text,
  cash_flow_volatility       text,
  note                       text,
  reviewed_by                text,
  reviewed_at                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS verification_banking_reviews_tenant_case_uq
  ON verification_banking_reviews (tenant_id, case_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 7. Phase 9 risk tier + capacity.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_risk_assessments (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL,
  case_id                  text NOT NULL,
  risk_tier                text,
  business_age_months      integer,
  authority_age_months     integer,
  avg_weekly_net_cash_flow numeric(14,2),
  avg_weekly_fuel_expense  numeric(14,2),
  adjusted_weekly_capacity numeric(14,2),
  risk_factor              numeric(4,3),
  recommended_limit        numeric(14,2),
  requested_limit          numeric(14,2),
  analyst_recommendation   text,
  key_risks                jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at              timestamptz,
  assessed_by              text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS verification_risk_assessments_tenant_case_uq
  ON verification_risk_assessments (tenant_id, case_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- 8. Policy. Moderate and Weak factors stay NULL on purpose — the SOP marks them unset, so the
--    capacity calculator REFUSES rather than inventing a number. A default here would silently
--    approve limits nobody signed off on.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_policy (
  tenant_id            text PRIMARY KEY,
  strong_factor        numeric(4,3) DEFAULT 0.800,
  moderate_factor      numeric(4,3),
  weak_factor          numeric(4,3),
  adb_review_threshold numeric(14,2) NOT NULL DEFAULT 500,
  nsf_review_threshold integer NOT NULL DEFAULT 2,
  bank_first_truck_min integer NOT NULL DEFAULT 10,
  wex_card_cutoff      integer NOT NULL DEFAULT 20,
  updated_by           text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- DEFAULT_TENANT_ID (src/config/constants.ts). Other tenants get a row lazily on first read.
INSERT INTO verification_policy (tenant_id) VALUES ('octane')
ON CONFLICT (tenant_id) DO NOTHING;
