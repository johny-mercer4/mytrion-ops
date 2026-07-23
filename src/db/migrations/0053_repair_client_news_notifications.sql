-- Repair: journal timestamps for 0042–0044 were overwritten during retention
-- renumbering (hashes matched 0049–0051), so client_news / mini_app notification
-- tables never landed on DBs that already had those journal slots. Idempotent.

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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_news_publish_idx" ON "client_news" ("tenant_id", "publish_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_news_reads" (
  "id" text PRIMARY KEY NOT NULL,
  "news_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "read_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_news_reads_news_user_uq" ON "client_news_reads" ("news_id", "telegram_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mini_app_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "telegram_user_id" text,
  "type" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'new',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mini_app_notifications_dedupe_uq" ON "mini_app_notifications" ("dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mini_app_notifications_status_idx" ON "mini_app_notifications" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mini_app_notifications_carrier_idx" ON "mini_app_notifications" ("tenant_id", "carrier_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mini_app_notification_prefs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "type" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mini_app_notification_prefs_user_type_uq" ON "mini_app_notification_prefs" ("telegram_user_id", "type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mini_app_notification_state" (
  "scope" text PRIMARY KEY NOT NULL,
  "watermark" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
