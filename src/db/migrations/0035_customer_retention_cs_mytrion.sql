-- Customer Retention Zoho profile → Customer Service Mytrion (Retention desk / claims / CITI).
-- Idempotent upsert for tenants that already seeded an empty allowed_mytrions row.
UPDATE "mytrion_profile_defaults"
SET
  "allowed_mytrions" = '["customer-service"]'::jsonb,
  "home_mytrion" = 'customer-service',
  "updated_at" = NOW()
WHERE "profile_key" = 'customer retention'
  AND (
    "allowed_mytrions" = '[]'::jsonb
    OR "allowed_mytrions" IS NULL
    OR "home_mytrion" IS NULL
  );
