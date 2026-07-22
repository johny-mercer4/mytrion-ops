-- Agent bot multi-session: group chat -> carrier mapping. Hand-written like 0025-0033.
CREATE TABLE IF NOT EXISTS "support_bot_chats" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "chat_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_chats_chat_uq" ON "support_bot_chats" ("chat_id");
CREATE INDEX IF NOT EXISTS "support_bot_chats_carrier_idx" ON "support_bot_chats" ("tenant_id", "carrier_id");
