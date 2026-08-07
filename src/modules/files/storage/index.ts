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
import { dropboxStorage } from './dropboxStorage.js';
import { s3Storage } from './s3Storage.js';

export type { ObjectStorage } from './types.js';

/** Values persisted in `file_assets.storage_provider`. Adding one means adding a migration value too. */
export type StorageProvider = 's3' | 'dropbox';

let override: ObjectStorage | null = null;

const ADAPTERS: Record<StorageProvider, ObjectStorage> = {
  s3: s3Storage,
  dropbox: dropboxStorage,
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
export function commsStorageProvider(): StorageProvider {
  return env.COMMS_STORAGE_PROVIDER;
}

/**
 * Where a NEW general-pipeline file goes — uploads (import) and generated CSV/Excel/PDF (export).
 *
 * Only safe to read from env because `storeFile` persists the result on the `file_assets` row, so flipping
 * this changes the destination of the NEXT file and nothing about the ones already stored.
 */
export function fileStorageProvider(): StorageProvider {
  return env.FILE_STORAGE_PROVIDER;
}

export function setStorageForTests(storage: ObjectStorage | null): void {
  override = storage;
}
