-- Collection workspace — map the finder-owned snapshots that already exist in the app Postgres.
--
-- Hand-written and idempotent, like 0124. CREATE TABLE IF NOT EXISTS is a no-op on the seeded
-- environment (494 cases / 526 invoices / 9,258 array reports) and creates the tables on a
-- fresh migrate. Indexes match the live definitions so a new DB gets the same access path.

CREATE TABLE IF NOT EXISTS collection_cases (
  id                         text PRIMARY KEY,
  zoho_record_id             text,
  source                     text NOT NULL,
  carrier_id                 text NOT NULL,
  status                     text NOT NULL,
  collection_stage           text NOT NULL,
  case_created_date          date NOT NULL,
  placement_date             date,
  reopen_count               integer NOT NULL DEFAULT 0,
  closed_at                  timestamptz,
  closed_reason              text,
  total_debt_amount          numeric NOT NULL,
  total_invoice_amount       numeric NOT NULL,
  total_amount_paid          numeric NOT NULL,
  issue_invoice_count        integer NOT NULL DEFAULT 0,
  first_delinquent_date      date,
  days_past_due              integer NOT NULL DEFAULT 0,
  collection_trigger_rule    text,
  currency                   text NOT NULL DEFAULT 'USD',
  display_name               text,
  debtor_company_name        text,
  debtor_full_name           text,
  debtor_email               text,
  debtor_secondary_email     text,
  debtor_phone               text,
  debtor_cell_phone          text,
  debtor_address             text,
  debtor_city                text,
  debtor_state               text,
  debtor_zip_code            text,
  debtor_mc_dot              text,
  debtor_date_of_birth       date,
  zoho_deal_id               text,
  agency_transfer_date       date,
  first_collection_agency    text,
  assignee_user_id           text,
  last_synced_at             timestamptz,
  raw                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS collection_cases_carrier_uk
  ON collection_cases (carrier_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS collection_cases_zoho_uk
  ON collection_cases (zoho_record_id) WHERE (zoho_record_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_cases_status_stage_idx
  ON collection_cases (status, collection_stage);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_cases_open_debt_idx
  ON collection_cases (status, total_debt_amount DESC) WHERE (status = 'open');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_cases_placement_idx
  ON collection_cases (placement_date) WHERE (placement_date IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_cases_zoho_deal_idx
  ON collection_cases (zoho_deal_id) WHERE (zoho_deal_id IS NOT NULL);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS collection_case_invoices (
  id                   text PRIMARY KEY,
  case_id              text NOT NULL REFERENCES collection_cases(id) ON DELETE CASCADE,
  cmp_invoice_id       bigint NOT NULL,
  invoice_number       text,
  cmp_stage            text,
  status               text,
  period_from          date,
  period_to            date,
  period_label         text,
  total_amount         numeric NOT NULL,
  total_paid           numeric NOT NULL,
  remaining_amount     numeric NOT NULL,
  total_merchant_fee   numeric NOT NULL,
  due_date             date,
  cmp_create_date      date,
  payment_day          text,
  invoice_notes        text,
  zoho_deal_id         text,
  cmp_update_date      timestamptz,
  data_source          text NOT NULL,
  synced_at            timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS collection_case_invoices_case_cmp_uk
  ON collection_case_invoices (case_id, cmp_invoice_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_case_invoices_case_idx
  ON collection_case_invoices (case_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collection_case_invoices_cmp_idx
  ON collection_case_invoices (cmp_invoice_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS array_reports (
  id                         text PRIMARY KEY,
  zoho_record_id             text,
  carrier_id                 text NOT NULL,
  report_period              text NOT NULL,
  display_name               text,
  company_name               text,
  customer_account_number    text,
  association_code           text,
  first_name                 text,
  last_name                  text,
  first_line_of_address      text,
  second_line_of_address     text,
  city                       text,
  state                      text,
  zip_code                   text,
  telephone_number           text,
  email                      text,
  secondary_email            text,
  date_of_birth              date,
  date_open                  date,
  carrier_type               text,
  account_status             text,
  account_type               text,
  portfolio_type             text,
  payment_rating             text,
  payment_history_profile    text,
  terms                      text,
  terms_frequency            text,
  credit_limit               numeric,
  highest_credit             numeric,
  current_balance            numeric,
  amount_past_due            numeric,
  date_of_first_delinquency  date,
  date_of_last_payment       date,
  date_closed                date,
  placement_date             date,
  agency_transfer_date       date,
  has_agency                 boolean,
  agency_name                text,
  months_delinquent          integer,
  excluded_reason            text,
  validation_errors          text,
  needs_dob_lookup           boolean,
  currency                   text NOT NULL DEFAULT 'USD',
  zoho_owner_id              text,
  zoho_created_time          timestamptz,
  zoho_modified_time         timestamptz,
  last_synced_at             timestamptz,
  raw                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS array_reports_carrier_period_uk
  ON array_reports (carrier_id, report_period);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS array_reports_zoho_uk
  ON array_reports (zoho_record_id) WHERE (zoho_record_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS array_reports_carrier_idx
  ON array_reports (carrier_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS array_reports_period_idx
  ON array_reports (report_period);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS array_reports_status_type_idx
  ON array_reports (account_status, carrier_type);
