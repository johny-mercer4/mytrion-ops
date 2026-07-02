/**
 * Storage singleton with a test seam: production always resolves the S3 adapter; tests swap
 * in a mock via setStorageForTests (mirroring how other modules stub integrations).
 */
import type { ObjectStorage } from './types.js';
import { s3Storage } from './s3Storage.js';

export type { ObjectStorage } from './types.js';

let override: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  return override ?? s3Storage;
}

export function setStorageForTests(storage: ObjectStorage | null): void {
  override = storage;
}
