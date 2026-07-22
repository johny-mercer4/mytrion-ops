-- Mini-app notification outbox + prefs (ultraplan N-0). Hand-written like 0025-0030:
-- the snapshot chain has a pre-existing fork (0022/0023), so drizzle-kit generate is
-- unavailable until that history is repaired — tables here mirror
-- src/db/schema/mini_app_notifications.ts exactly.
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

CREATE UNIQUE INDEX IF NOT EXISTS "mini_app_notifications_dedupe_uq" ON "mini_app_notifications" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "mini_app_notifications_status_idx" ON "mini_app_notifications" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "mini_app_notifications_carrier_idx" ON "mini_app_notifications" ("tenant_id", "carrier_id", "created_at");

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

CREATE UNIQUE INDEX IF NOT EXISTS "mini_app_notification_prefs_user_type_uq" ON "mini_app_notification_prefs" ("telegram_user_id", "type");
