-- 0132: canned replies — reusable message templates agents insert into the composer.
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS) so a hand-edited baseline is safe on a fresh and an
-- existing DB. Team-shared, tenant-scoped; carries no client data.

CREATE TABLE IF NOT EXISTS mytrion_canned_replies (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  department text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_zoho_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_canned_replies_picker_idx
  ON mytrion_canned_replies (tenant_id, active, sort_order);
