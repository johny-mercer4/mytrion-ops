CREATE TABLE IF NOT EXISTS "retention_rr_cursors" (
  "tenant_id" text PRIMARY KEY,
  "last_zoho_user_id" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
