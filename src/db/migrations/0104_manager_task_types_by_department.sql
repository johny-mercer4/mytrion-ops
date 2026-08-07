-- Manager Tasks: scope the task-type catalog to a Manager desk, and seed a real one.
--
-- Hand-written, not `drizzle-kit generate`d. Generating on this branch emits ~15 unrelated CREATE
-- TABLEs (the comms/ticketing tables whose schema files live here but whose CREATE migrations are
-- on feature/Communication) plus `file_assets.storage_provider` — drizzle diffs the schema against
-- the journal snapshot and cannot know those arrive from another branch. Only the four statements
-- below belong to this change.
--
-- Before this, `mytrion_task_types` held exactly one row tenant-wide (`general`), so the Manager
-- Tasks form's Type control was a single-option select on every desk.
--
-- `department` is NULLABLE on purpose: NULL means "every desk may use this type", which is a real
-- state and not a missing value. The (tenant_id, code) unique key is unchanged, so a code still
-- means one thing tenant-wide — Billing cannot redefine `follow_up`. Widen a type by nulling its
-- department; narrow it by setting one.

ALTER TABLE "mytrion_task_types"
  ADD COLUMN IF NOT EXISTS "department" text;
--> statement-breakpoint

ALTER TABLE "mytrion_task_types"
  ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 100 NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mytrion_task_types_tenant_dept_idx"
  ON "mytrion_task_types" ("tenant_id", "department", "active");
--> statement-breakpoint

-- Seed. Shared types first (department NULL), then one block per desk. ON CONFLICT DO NOTHING keeps
-- this idempotent and, critically, does NOT clobber a label an admin has already edited.
INSERT INTO "mytrion_task_types" ("id","tenant_id","code","label","department","sort_order")
VALUES
  -- ── Shared: available on every desk ─────────────────────────────────────────
  ('mtt_general',    'octane','general',    'General',            NULL, 10),
  ('mtt_follow_up',  'octane','follow_up',  'Follow up',          NULL, 20),
  ('mtt_review',     'octane','review',     'Review',             NULL, 30),
  ('mtt_escalation', 'octane','escalation', 'Escalation',         NULL, 40),
  ('mtt_admin',      'octane','admin',      'Admin / paperwork',  NULL, 50),
  ('mtt_training',   'octane','training',   'Training',           NULL, 60),

  -- ── Sales ───────────────────────────────────────────────────────────────────
  ('mtt_sales_lead_work',  'octane','lead_work',      'Work a lead',        'sales', 110),
  ('mtt_sales_quote',      'octane','quote',          'Prepare a quote',    'sales', 120),
  ('mtt_sales_onboarding', 'octane','onboarding',     'Onboard a carrier',  'sales', 130),
  ('mtt_sales_winback',    'octane','winback',        'Win-back outreach',  'sales', 140),
  ('mtt_sales_pipeline',   'octane','pipeline_clean', 'Pipeline clean-up',  'sales', 150),

  -- ── Customer Service ────────────────────────────────────────────────────────
  ('mtt_cs_ticket',   'octane','ticket_backlog', 'Ticket backlog',     'customer-service', 210),
  ('mtt_cs_callback', 'octane','callback',       'Customer callback',  'customer-service', 220),
  ('mtt_cs_citi',     'octane','citi_handoff',   'CITI hand-off',      'customer-service', 230),

  -- ── Billing ─────────────────────────────────────────────────────────────────
  ('mtt_bill_invoice',  'octane','invoice_issue',  'Invoice issue',        'billing', 310),
  ('mtt_bill_recon',    'octane','reconciliation', 'Payment reconciliation','billing', 320),
  ('mtt_bill_prepay',   'octane','prepay_balance', 'Prepay balance check', 'billing', 330),

  -- ── Finance ─────────────────────────────────────────────────────────────────
  ('mtt_fin_monthend', 'octane','month_end',   'Month-end close',    'finance', 410),
  ('mtt_fin_margin',   'octane','margin_check','Margin check',       'finance', 420),
  ('mtt_fin_forecast', 'octane','forecast',    'Forecast input',     'finance', 430),

  -- ── Collection ──────────────────────────────────────────────────────────────
  ('mtt_col_outreach', 'octane','debt_outreach', 'Debtor outreach',   'collection', 510),
  ('mtt_col_plan',     'octane','payment_plan',  'Payment plan',      'collection', 520),
  ('mtt_col_agency',   'octane','agency_filing', 'Agency filing',     'collection', 530),

  -- ── Mobile ──────────────────────────────────────────────────────────────────
  ('mtt_mob_release',  'octane','app_release',  'App release check',  'mobile', 610),
  ('mtt_mob_bug',      'octane','app_bug',      'App bug triage',     'mobile', 620),

  -- ── Verification ────────────────────────────────────────────────────────────
  ('mtt_ver_credit',     'octane','credit_review',    'Credit review',      'verification', 710),
  ('mtt_ver_compliance', 'octane','compliance_check', 'Compliance check',   'verification', 720),
  ('mtt_ver_vendor',     'octane','vendor_followup',  'Vendor follow-up',   'verification', 730)
ON CONFLICT ("tenant_id","code") DO NOTHING;
