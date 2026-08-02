-- Production safety for the multi-carrier Telegram gateway:
-- durable one-time confirmations and inbound-update replay deduplication.

-- Fail closed instead of silently deleting production history. Duplicate cleanup must be an
-- explicit, reviewed operator action with a backup; this migration only verifies the invariant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "support_bot_messages"
    WHERE "msg_id" IS NOT NULL
    GROUP BY "tenant_id", "chat_id", "msg_id", "direction"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'support_bot_messages contains duplicate inbound replay keys; back up and clean them before migration 0089';
  END IF;
END $$;
--> statement-breakpoint

-- Do not let a boot migration wait indefinitely behind production traffic. PostgreSQL builds this
-- index inside Drizzle's transaction, so CONCURRENTLY is not available here; fail and retry during
-- a reviewed quiet window if the lock cannot be acquired promptly.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '2min';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_messages_inbound_replay_uq"
  ON "support_bot_messages" ("tenant_id", "chat_id", "msg_id", "direction")
  WHERE "msg_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_bot_confirmations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "carrier_id" text NOT NULL,
  "chat_id" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "message_id" text NOT NULL,
  "tool_name" text NOT NULL,
  "arguments" jsonb NOT NULL,
  "arguments_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_update_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_bot_confirmations_status_check"
    CHECK ("status" IN ('pending', 'consumed', 'cancelled', 'expired'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_confirmations_tenant_token_uq"
  ON "support_bot_confirmations" ("tenant_id", "token_hash");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "support_bot_confirmations_pending_expiry_idx"
  ON "support_bot_confirmations" ("status", "expires_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "support_bot_confirmations_actor_message_idx"
  ON "support_bot_confirmations" ("tenant_id", "chat_id", "telegram_user_id", "message_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_bot_gateway_leases" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "bot_identity" text NOT NULL,
  "holder_id" text NOT NULL,
  "fencing_token" integer DEFAULT 1 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_gateway_leases_identity_uq"
  ON "support_bot_gateway_leases" ("tenant_id", "bot_identity");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "support_bot_gateway_leases_expiry_idx"
  ON "support_bot_gateway_leases" ("expires_at");
