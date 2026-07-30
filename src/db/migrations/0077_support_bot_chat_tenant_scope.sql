DROP INDEX IF EXISTS "support_bot_chats_chat_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_chats_tenant_chat_uq"
  ON "support_bot_chats" ("tenant_id", "chat_id");
