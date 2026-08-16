/**
 * Storage resolution, with a test seam.
 *
 * TWO things are deliberately separate here:
 *
 *   `getStorage()`         — the DEFAULT provider for the existing file pipeline. Still S3, because every
 *                            `file_assets` row written so far lives there.
 *   `storageFor(provider)` — resolve a SPECIFIC provider, for a row that records where its own bytes are.
 *
 * That split is what makes adding Dropbox safe. A single global switch would repoint reads for files that
 * are still on S3 and they would 404 — so the provider a file was stored under travels with the row, and
 * `COMMS_STORAGE_PROVIDER` only decides where the NEXT comms attachment goes.
 *
 * The test override wins for both, so a suite can stub storage without knowing which provider a fixture
 * claims.
 */
import { env } from '../../../config/env.js';
import type { ObjectStorage } from './types.js';
import {
  dropboxMaintenanceStorage,
  dropboxStorage,
  dropboxVerificationStorage,
  dropboxHrStorage,
} from './dropboxStorage.js';
import { s3Storage } from './s3Storage.js';

export type { ObjectStorage } from './types.js';

/**
 * Values persisted in a row's storage-provider column. Each TABLE only ever writes the values it
 * actually has a folder for — `file_assets.storage_provider` is `CommsStorageProvider`,
 * `maintenance_case_attachments.storage_provider` is `MaintenanceStorageProvider` — so a typo like
 * handing Maintenance's provider to `fileRepo.create` is a compile error, not a 404 discovered later.
 * `dropbox_maintenance` is a distinct value from `dropbox` even though both are Dropbox — the value is
 * what tells `storageFor` which ROOT FOLDER to resolve, and comms/Maintenance must never share one.
 * Adding a new value anywhere means adding a migration for it too.
 */
export type CommsStorageProvider = 's3' | 'dropbox';
export type MaintenanceStorageProvider = 's3' | 'dropbox_maintenance';
export type VerificationStorageProvider = 's3' | 'dropbox_verification';
export type HrStorageProvider = 's3' | 'dropbox_hr';
/**
 * What `file_assets.storage_provider` may hold.
 *
 * Wider than `CommsStorageProvider` because HR photos share that table but must NOT share the comms
 * folder. The DB CHECK constraint (migration 0125) is the other half of this claim.
 */
export type FileAssetStorageProvider = CommsStorageProvider | 'dropbox_hr';
export type StorageProvider =
  | CommsStorageProvider
  | MaintenanceStorageProvider
  | VerificationStorageProvider
  | HrStorageProvider;

let override: ObjectStorage | null = null;

const ADAPTERS: Record<StorageProvider, ObjectStorage> = {
  s3: s3Storage,
  dropbox: dropboxStorage,
  dropbox_maintenance: dropboxMaintenanceStorage,
  dropbox_verification: dropboxVerificationStorage,
  dropbox_hr: dropboxHrStorage,
};

/**
 * S3, always — for the callers that do NOT record a provider alongside their key.
 *
 * DO NOT make this honour `FILE_STORAGE_PROVIDER`. `maintenance_case_attachments` stores an `s3_key` with
 * no `storage_provider` column and resolves both its writes and its reads through this function, so a
 * global switch would send new attachments to Dropbox and simultaneously repoint every existing row's read
 * at Dropbox — where those bytes are not. Reads would 404 and deletes would silently no-op.
 *
 * Callers that CAN follow the env are the ones whose row records the answer: see `fileStorageProvider()`.
 */
export function getStorage(): ObjectStorage {
  return override ?? s3Storage;
}

/**
 * The adapter for one specific provider.
 *
 * An unknown value falls back to S3 rather than throwing: it can only come from a database column, and a
 * row written by a newer deploy must not make an older one crash on read — a 404 from the wrong provider is
 * recoverable, a boot loop is not.
 */
export function storageFor(provider: string | null | undefined): ObjectStorage {
  if (override) return override;
  return ADAPTERS[(provider ?? 's3') as StorageProvider] ?? s3Storage;
}

/** Where a NEW comms attachment goes. */
export function commsStorageProvider(): CommsStorageProvider {
  return env.COMMS_STORAGE_PROVIDER;
}

/** Where a NEW Maintenance attachment goes. */
export function maintenanceStorageProvider(): MaintenanceStorageProvider {
  return env.MAINTENANCE_STORAGE_PROVIDER;
}

/**
 * Where a NEW Verification applicant document goes. Defaults to Dropbox (not S3, unlike the older
 * pipelines) because the underwriting flow was built on Dropbox from the start — there are no
 * pre-existing S3 rows for this table whose reads a default could repoint.
 */
export function verificationStorageProvider(): VerificationStorageProvider {
  return env.VERIFICATION_STORAGE_PROVIDER;
}

/**
 * Where a NEW general-pipeline file goes — uploads (import) and generated CSV/Excel/PDF (export).
 *
 * Only safe to read from env because `storeFile` persists the result on the `file_assets` row, so flipping
 * this changes the destination of the NEXT file and nothing about the ones already stored. Narrowed to
 * `CommsStorageProvider`, not the broader `StorageProvider` — this feeds `file_assets.storage_provider`,
 * which (like comms) has no `dropbox_maintenance` folder to resolve.
 */
export function fileStorageProvider(): CommsStorageProvider {
  return env.FILE_STORAGE_PROVIDER;
}

/**
 * Where a NEW HR people file goes. Separate from `fileStorageProvider()` so employee photos cannot
 * be dragged into the comms folder by a change to the general file pipeline's env.
 */
export function hrStorageProvider(): HrStorageProvider {
  return env.HR_STORAGE_PROVIDER;
}

export function setStorageForTests(storage: ObjectStorage | null): void {
  override = storage;
}
