-- 0090: a file row records WHERE ITS OWN BYTES ARE.
--
-- Comms chat attachments go to Dropbox, while every file_assets row written until now is on S3/MinIO. A
-- single global storage switch would repoint reads for the existing rows and they would 404, so the provider
-- has to travel with the row: `storage_provider` is what `storageFor(row.storage_provider)` resolves, and
-- the env setting only decides where the NEXT upload goes.
--
-- This is also what makes delete correct. `fileService.deleteFile` previously handed `s3_key` to the S3
-- client unconditionally; with two providers that would silently fail to remove a Dropbox object while
-- reporting success, leaving the bytes behind after the row was gone.
--
-- Defaults to 's3' and backfills every existing row, because that is where they genuinely are — a NULL here
-- would be indistinguishable from "unknown" on rows we know the answer for.
ALTER TABLE file_assets
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 's3';
--> statement-breakpoint

-- Constrained rather than free text: an unrecognised value resolves to the S3 adapter at runtime (a
-- deliberate fail-soft so an older deploy cannot crash on a newer row), which means a typo would silently
-- read from the wrong store. Better to refuse the write.
ALTER TABLE file_assets
  DROP CONSTRAINT IF EXISTS file_assets_storage_provider_chk;
--> statement-breakpoint

ALTER TABLE file_assets
  ADD CONSTRAINT file_assets_storage_provider_chk CHECK (storage_provider IN ('s3', 'dropbox'));
--> statement-breakpoint

-- The cleanup sweep ("every Dropbox object for this tenant") and the reconciliation report both filter on
-- provider; without this they are a full scan of every file in the tenant.
CREATE INDEX IF NOT EXISTS file_assets_tenant_provider_idx
  ON file_assets (tenant_id, storage_provider);
