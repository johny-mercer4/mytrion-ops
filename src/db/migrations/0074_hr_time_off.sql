-- Mytrion-owned Time Off: policies, yearly balances, holidays, two-stage requests, and journal.
-- Zoho People is intentionally not referenced by this runtime schema.

CREATE TABLE IF NOT EXISTS "hr_leave_types" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "is_paid" boolean NOT NULL,
  "default_days" numeric(7,2) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_leave_types_tenant_code_uk"
  ON "hr_leave_types" ("tenant_id","code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_leave_types_tenant_order_idx"
  ON "hr_leave_types" ("tenant_id","is_active","sort_order");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hr_leave_entitlements" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "employee_id" text NOT NULL,
  "leave_type_id" text NOT NULL,
  "year" integer NOT NULL,
  "allocated_days" numeric(7,2) NOT NULL,
  "adjustment_days" numeric(7,2) DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_leave_entitlements_scope_uk"
  ON "hr_leave_entitlements" ("tenant_id","employee_id","leave_type_id","year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_leave_entitlements_tenant_year_idx"
  ON "hr_leave_entitlements" ("tenant_id","year","employee_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hr_holidays" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "date" date NOT NULL,
  "name" text NOT NULL,
  "location" text DEFAULT 'Uzbekistan' NOT NULL,
  "is_half_day" boolean DEFAULT false NOT NULL,
  "session" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_holidays_tenant_date_name_uk"
  ON "hr_holidays" ("tenant_id","date","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_holidays_tenant_date_idx"
  ON "hr_holidays" ("tenant_id","date","is_active");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hr_leave_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "final_approver_employee_id" text,
  "timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hr_leave_settings_tenant_uk"
  ON "hr_leave_settings" ("tenant_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hr_leave_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "employee_id" text NOT NULL,
  "leave_type_id" text NOT NULL,
  "leave_type_code" text NOT NULL,
  "leave_type_name" text NOT NULL,
  "from_date" date NOT NULL,
  "to_date" date NOT NULL,
  "day_part" text DEFAULT 'full' NOT NULL,
  "requested_days" numeric(7,2) NOT NULL,
  "reason" text,
  "status" text NOT NULL,
  "current_approver_employee_id" text,
  "lead_approver_employee_id" text,
  "hr_approver_employee_id" text NOT NULL,
  "lead_decision_by_employee_id" text,
  "lead_decision_at" timestamp with time zone,
  "lead_comment" text,
  "hr_decision_by_employee_id" text,
  "hr_decision_at" timestamp with time zone,
  "hr_comment" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_leave_requests_tenant_employee_date_idx"
  ON "hr_leave_requests" ("tenant_id","employee_id","from_date","to_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_leave_requests_tenant_approver_status_idx"
  ON "hr_leave_requests" ("tenant_id","current_approver_employee_id","status","submitted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_leave_requests_tenant_status_idx"
  ON "hr_leave_requests" ("tenant_id","status","submitted_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hr_leave_request_actions" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "request_id" text NOT NULL,
  "action" text NOT NULL,
  "actor_employee_id" text,
  "actor_user_id" text NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hr_leave_request_actions_tenant_request_idx"
  ON "hr_leave_request_actions" ("tenant_id","request_id","created_at");
--> statement-breakpoint

-- The live Uzbekistan policies requested for Mytrion.
INSERT INTO "hr_leave_types"
  ("id","tenant_id","code","name","is_paid","default_days","is_active","sort_order")
SELECT 'hrlt_sick_' || substr(md5(t."id"), 1, 20), t."id", 'sick', 'Sick Leave', true, 7.00, true, 10
FROM "tenants" t
ON CONFLICT ("tenant_id","code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "hr_leave_types"
  ("id","tenant_id","code","name","is_paid","default_days","is_active","sort_order")
SELECT 'hrlt_annual_' || substr(md5(t."id"), 1, 18), t."id", 'annual_paid', 'Annual Paid Leave', true, 17.50, true, 20
FROM "tenants" t
ON CONFLICT ("tenant_id","code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "hr_leave_types"
  ("id","tenant_id","code","name","is_paid","default_days","is_active","sort_order")
SELECT 'hrlt_unpaid_' || substr(md5(t."id"), 1, 18), t."id", 'unpaid', 'Unpaid Leave', false, 60.00, true, 30
FROM "tenants" t
ON CONFLICT ("tenant_id","code") DO NOTHING;
--> statement-breakpoint

-- Kristina Smirnova is the initial final approver when her employee record is present.
INSERT INTO "hr_leave_settings" ("id","tenant_id","final_approver_employee_id")
SELECT
  'hrls_' || substr(md5(t."id"), 1, 24),
  t."id",
  (
    SELECT e."id"
    FROM "hr_employees" e
    WHERE e."tenant_id" = t."id"
      AND lower(btrim(e."first_name")) = 'kristina'
      AND lower(btrim(e."last_name")) = 'smirnova'
    ORDER BY e."updated_at" DESC
    LIMIT 1
  )
FROM "tenants" t
ON CONFLICT ("tenant_id") DO NOTHING;
--> statement-breakpoint

-- Snapshot this year's defaults for every active employee.
INSERT INTO "hr_leave_entitlements"
  ("id","tenant_id","employee_id","leave_type_id","year","allocated_days","adjustment_days")
SELECT
  'hrle_' || substr(md5(e."tenant_id" || ':' || e."id" || ':' || lt."id" || ':' ||
    extract(year from current_date)::text), 1, 24),
  e."tenant_id",
  e."id",
  lt."id",
  extract(year from current_date)::integer,
  lt."default_days",
  0
FROM "hr_employees" e
JOIN "hr_leave_types" lt ON lt."tenant_id" = e."tenant_id" AND lt."is_active" = true
WHERE lower(e."status") NOT IN ('terminated', 'inactive')
ON CONFLICT ("tenant_id","employee_id","leave_type_id","year") DO NOTHING;
--> statement-breakpoint

-- 2026 Uzbekistan calendar audited from the existing Zoho People configuration.
INSERT INTO "hr_holidays"
  ("id","tenant_id","date","name","location","is_half_day","is_active")
SELECT
  'hrh_' || replace(h.d::text, '-', '') || '_' || substr(md5(t."id" || h.n), 1, 12),
  t."id", h.d, h.n, 'Uzbekistan', false, true
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('2026-01-01'::date, 'New Year''s Day'),
    ('2026-01-02'::date, 'New Year''s Day'),
    ('2026-03-20'::date, 'Eid Al-Fitr (Ramadan Hayit)'),
    ('2026-05-25'::date, 'Memorial Day'),
    ('2026-05-26'::date, 'Eid al-Adha (Kurban Bayram)'),
    ('2026-07-04'::date, 'Independence Day'),
    ('2026-09-07'::date, 'Labour Day'),
    ('2026-10-12'::date, 'Thanksgiving Day'),
    ('2026-11-11'::date, 'Veterans Day'),
    ('2026-12-25'::date, 'Christmas'),
    ('2026-12-31'::date, 'New Year''s Eve')
) AS h(d, n)
ON CONFLICT ("tenant_id","date","name") DO NOTHING;
