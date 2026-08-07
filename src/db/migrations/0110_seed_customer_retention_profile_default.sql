-- Seed the Customer Retention → Customer Service profile default.
--
-- 0035_customer_retention_cs_mytrion.sql calls itself an "idempotent upsert" but is only an
-- UPDATE, so on a database where the `Customer Retention` row was never inserted it does nothing.
-- The row therefore exists only where someone created it through Admin → User Management, which
-- means a FRESH database (CI, a new developer's machine, a new tenant) has no Customer Service
-- department mapping at all and every department-gated /v1/cs route answers 403.
--
-- Follows the 0086_hr_workspace_recovery pattern: derive the id from the tenant, always include the
-- default `octane` tenant, and ON CONFLICT DO NOTHING so an existing row — including the one
-- production already has, configured through the admin UI — is never modified. This migration can
-- only ADD a missing default; it can never widen or narrow access that is already configured.

CREATE TEMP TABLE "_cs_profile_tenants" ON COMMIT DROP AS
SELECT DISTINCT "tenant_id"
FROM (
  SELECT "tenant_id" FROM "mytrion_profile_defaults"
  UNION ALL
  SELECT 'octane'::text
) tenant_scope
WHERE "tenant_id" IS NOT NULL AND btrim("tenant_id") <> '';
--> statement-breakpoint

INSERT INTO "mytrion_profile_defaults"
  ("id","tenant_id","profile_name","profile_key","allowed_mytrions","home_mytrion",
   "all_department_access","active")
SELECT
  'pd_cs_retention_' || substr(md5(tenant."tenant_id"), 1, 12),
  tenant."tenant_id",
  'Customer Retention',
  'customer retention',
  '["customer-service"]'::jsonb,
  'customer-service',
  false,
  true
FROM "_cs_profile_tenants" tenant
ON CONFLICT ("tenant_id","profile_key") DO NOTHING;
--> statement-breakpoint

-- Repeat 0035's repair for any row that was seeded empty before this migration existed.
UPDATE "mytrion_profile_defaults"
SET
  "allowed_mytrions" = '["customer-service"]'::jsonb,
  "home_mytrion" = 'customer-service',
  "updated_at" = now()
WHERE "profile_key" = 'customer retention'
  AND (
    "allowed_mytrions" = '[]'::jsonb
    OR "allowed_mytrions" IS NULL
    OR "home_mytrion" IS NULL
  );
