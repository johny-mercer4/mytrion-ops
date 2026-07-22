-- client_news (+ read receipts): announcements Octane writes for mini-app clients.
-- Hand-written like 0025-0031 (snapshot chain fork predates us). Notification tables
-- keep their 0031 names (mini_app_notifications / mini_app_notification_prefs).
CREATE TABLE IF NOT EXISTS "client_news" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "title" jsonb NOT NULL,
  "body" jsonb NOT NULL,
  "audience_scope" text NOT NULL DEFAULT 'all',
  "carrier_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "roles" jsonb NOT NULL DEFAULT '["owner","driver"]'::jsonb,
  "severity" text NOT NULL DEFAULT 'info',
  "pinned" boolean NOT NULL DEFAULT false,
  "publish_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "client_news_publish_idx" ON "client_news" ("tenant_id", "publish_at");

CREATE TABLE IF NOT EXISTS "client_news_reads" (
  "id" text PRIMARY KEY NOT NULL,
  "news_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "read_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_news_reads_news_user_uq" ON "client_news_reads" ("news_id", "telegram_user_id");
