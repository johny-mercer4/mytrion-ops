-- Poller watermark store (N-1: card_status diff poller). Hand-written like 0025-0032.
CREATE TABLE IF NOT EXISTS "mini_app_notification_state" (
  "scope" text PRIMARY KEY NOT NULL,
  "watermark" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
