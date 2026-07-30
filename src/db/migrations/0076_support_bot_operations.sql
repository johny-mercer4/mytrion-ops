CREATE SEQUENCE IF NOT EXISTS "support_bot_fencing_seq" AS BIGINT;

CREATE TABLE IF NOT EXISTS "support_bot_session_fences" (
  "tenant_id" text NOT NULL,
  "session_key_hash" text NOT NULL,
  "current_fence" bigint NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_session_fences_tenant_session_uq"
  ON "support_bot_session_fences" ("tenant_id", "session_key_hash");

CREATE TABLE IF NOT EXISTS "support_bot_operations" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "operation_type" text NOT NULL,
  "request_hash" text NOT NULL,
  "turn_id" text NOT NULL,
  "write_occurrence" integer NOT NULL,
  "session_key_hash" text NOT NULL,
  "fencing_token" bigint NOT NULL,
  "actor_telegram_user_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'processing',
  "phase" text NOT NULL DEFAULT 'claimed',
  "sanitized_response" jsonb,
  "error_code" text,
  "lease_expires_at" timestamp with time zone NOT NULL,
  "attempts" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_operations_tenant_idempotency_uq"
  ON "support_bot_operations" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_operations_tenant_turn_occurrence_uq"
  ON "support_bot_operations" ("tenant_id", "turn_id", "write_occurrence");
CREATE INDEX IF NOT EXISTS "support_bot_operations_tenant_session_idx"
  ON "support_bot_operations" ("tenant_id", "session_key_hash", "created_at");
CREATE INDEX IF NOT EXISTS "support_bot_operations_status_lease_idx"
  ON "support_bot_operations" ("status", "lease_expires_at");
