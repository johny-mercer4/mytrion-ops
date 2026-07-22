-- support_bot_messages: the agent bot's full group-message history (hamroh-v1 parity, central
-- Postgres). Written in batches by the gateway via /v1/support-bot/messages.
CREATE TABLE IF NOT EXISTS "support_bot_messages" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "chat_id" text NOT NULL,
  "msg_id" text,
  "telegram_user_id" text NOT NULL,
  "name" text NOT NULL,
  "direction" text NOT NULL,
  "text" text NOT NULL,
  "photo" boolean NOT NULL DEFAULT false,
  "engaged" boolean NOT NULL DEFAULT false,
  "sent_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ix_support_bot_messages_chat_time" ON "support_bot_messages" ("chat_id","sent_at");
CREATE INDEX IF NOT EXISTS "ix_support_bot_messages_carrier_time" ON "support_bot_messages" ("carrier_id","sent_at");
