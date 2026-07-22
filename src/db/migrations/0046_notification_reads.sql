-- Per-user notification read receipts (N-3): unread badge for the mini-app Inbox 'notifications'
-- tab. Mirrors client_news_reads — a notification can fan out to several users, so read state is
-- per (notification, user), not a column on the outbox row. Hand-written like 0025-0034; idempotent.
CREATE TABLE IF NOT EXISTS "mini_app_notification_reads" (
  "id" text PRIMARY KEY NOT NULL,
  "notification_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "read_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "mini_app_notification_reads_notif_user_uq" ON "mini_app_notification_reads" ("notification_id", "telegram_user_id");
