-- HR people files get their own Dropbox root instead of riding the comms folder.
--
-- `file_assets.storage_provider` is the per-row record of WHERE the bytes actually went, so widening
-- the CHECK is all that is needed: rows already written as 'dropbox' keep resolving to `/comms`
-- (which is where their bytes are), and only new HR files carry 'dropbox_hr' -> `/hr`. No object
-- has to be moved, and no existing read changes behaviour.
ALTER TABLE file_assets DROP CONSTRAINT IF EXISTS file_assets_storage_provider_chk;
--> statement-breakpoint
ALTER TABLE file_assets
  ADD CONSTRAINT file_assets_storage_provider_chk
  CHECK (storage_provider IN ('s3', 'dropbox', 'dropbox_hr'));
