-- Carrier-scoped attachments for Verification → Existing clients.
-- Metadata in Postgres; bytes in Dropbox `/verification` (or S3) via storageFor().
-- Hand-written and idempotent: carrier_attachments is not in drizzle.config (stale snapshot —
-- same reason 0101 / 0121 are hand-written). Safe on a fresh DB and on one that already has it.

CREATE TABLE IF NOT EXISTS "carrier_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "file_name" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "s3_key" text NOT NULL,
  "storage_provider" text NOT NULL DEFAULT 'dropbox_verification',
  "uploaded_by_user_id" text,
  "uploaded_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "carrier_attachments_storage_provider_chk"
    CHECK (storage_provider IN ('s3', 'dropbox_verification'))
);

CREATE INDEX IF NOT EXISTS "carrier_attachments_tenant_carrier_idx"
  ON "carrier_attachments" ("tenant_id", "carrier_id", "created_at");
