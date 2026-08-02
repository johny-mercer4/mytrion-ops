CREATE INDEX IF NOT EXISTS "mytrion_inbox_messages_tenant_owner_unread_idx"
  ON "mytrion_inbox_messages" ("tenant_id", "owner_zoho_user_id", "created_at")
  WHERE "read_at" IS NULL;
