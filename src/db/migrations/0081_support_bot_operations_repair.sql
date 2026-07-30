-- REPAIR: re-apply 0076_support_bot_operations, which the journal claims is applied on prod but which
-- never ran there.
--
-- This is not a support-bot change. It is a verbatim copy of 0076_support_bot_operations.sql, added
-- here because that migration was silently skipped on prod and the migrator cannot be made to revisit
-- it. Cause, precisely:
--
--   * `main` stamped 0076_support_bot_operations  when = 1785394800000
--   * this branch stamped 0076_maintenance_cases  when = 1785394800000   <-- same millisecond
--
--   The maintenance migration reached prod first and recorded created_at = 1785394800000. Drizzle
--   applies an entry only when `lastApplied.created_at < entry.when`; `<` is strict, so main's
--   migration — equal, not greater — was skipped. `pnpm db:migrate` logged success. The result on
--   prod (verified 2026-07-30): `support_bot_operations` and `support_bot_session_fences` absent,
--   all five of their indexes absent, while the journal implied the opposite. Deployed support-bot
--   code that touches those tables was failing at runtime.
--
--   The colliding maintenance stamps have been moved to 1785398400001/2 (see 0079's header). That
--   stops the collision recurring, but it does NOT bring main's 0076 back: its `when` still sits below
--   prod's ceiling, so it stays skipped forever. Only a fresh entry above the ceiling can repair the
--   database — this file.
--
-- Every statement is IF NOT EXISTS, so this is a no-op wherever 0076 did apply (a fresh database
-- applies 0076 first and then no-ops here). Safe to delete once every environment is past it.
--
-- Copied 2026-07-30 from 0076_support_bot_operations.sql. If that file has changed since, this copy is
-- stale — but being additive and IF NOT EXISTS, a stale copy can only create what is missing, never
-- alter what exists. Prefer a new migration on the support-bot side over editing this one.

CREATE SEQUENCE IF NOT EXISTS "support_bot_fencing_seq" AS BIGINT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "support_bot_session_fences" (
  "tenant_id" text NOT NULL,
  "session_key_hash" text NOT NULL,
  "current_fence" bigint NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_session_fences_tenant_session_uq"
  ON "support_bot_session_fences" ("tenant_id", "session_key_hash");
--> statement-breakpoint

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
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_operations_tenant_idempotency_uq"
  ON "support_bot_operations" ("tenant_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_bot_operations_tenant_turn_occurrence_uq"
  ON "support_bot_operations" ("tenant_id", "turn_id", "write_occurrence");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_bot_operations_tenant_session_idx"
  ON "support_bot_operations" ("tenant_id", "session_key_hash", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_bot_operations_status_lease_idx"
  ON "support_bot_operations" ("status", "lease_expires_at");
