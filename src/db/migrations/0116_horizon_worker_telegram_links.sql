-- Horizon worker CRM Mini App: Zoho session ↔ Telegram identity (HORIZON_BOT_TOKEN).
--
-- Hand-written rather than generated. `drizzle-kit generate` diffs against meta/*_snapshot.json,
-- and those snapshots have drifted from what is actually applied — running it here re-emits
-- already-applied tables. Idempotent DDL per CLAUDE.md.
--
-- Not sales_agent_mini_app_principals and not telegram_octane_users. Login remains Zoho OAuth;
-- this row is only the durable Telegram map for a later sendDocument slice.

CREATE TABLE IF NOT EXISTS horizon_worker_telegram_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  zoho_user_id text NOT NULL,
  telegram_user_id text NOT NULL,
  telegram_chat_id text,
  telegram_username text,
  zoho_username text,
  zoho_email text,
  linked_via text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  linked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS horizon_worker_tg_links_tenant_zoho_uk
  ON horizon_worker_telegram_links (tenant_id, zoho_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS horizon_worker_tg_links_tenant_tg_uk
  ON horizon_worker_telegram_links (tenant_id, telegram_user_id);

CREATE INDEX IF NOT EXISTS horizon_worker_tg_links_tenant_idx
  ON horizon_worker_telegram_links (tenant_id);
