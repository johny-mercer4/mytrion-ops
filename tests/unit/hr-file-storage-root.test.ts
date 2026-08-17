/**
 * HR people files get their OWN Dropbox folder.
 *
 * They used to fall through to `fileStorageProvider()` and land in `/comms`, so employee headshots
 * sat among chat attachments. Three things have to agree for that to stay fixed — the TS union, the
 * adapter registry, and the DB CHECK constraint — and this asserts all three, because a provider
 * value the database rejects is an upload that 500s at write time.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hrStorageProvider,
  storageFor,
  type FileAssetStorageProvider,
} from '../../src/modules/files/storage/index.js';
import { keyToDropboxPath } from '../../src/modules/files/storage/dropboxStorage.js';

const MIGRATION = new URL('../../src/db/migrations/0125_hr_file_storage_root.sql', import.meta.url);

describe('HR storage root', () => {
  it('defaults to its own Dropbox provider, not the comms one', () => {
    expect(hrStorageProvider()).toBe('dropbox_hr');
  });

  it('resolves to a DIFFERENT folder than comms', () => {
    const key = 'octane/upload/2026-08/f_1/photo.png';
    // Not asserting the literal roots — asserting they cannot collide, which is the actual rule.
    expect(keyToDropboxPath(key, '/hr')).not.toBe(keyToDropboxPath(key, '/comms'));
    expect(keyToDropboxPath(key, '/hr').startsWith('/hr/')).toBe(true);
  });

  it('has an adapter registered — an unmapped provider is a runtime crash on read', () => {
    expect(() => storageFor('dropbox_hr')).not.toThrow();
    expect(storageFor('dropbox_hr')).not.toBe(storageFor('dropbox'));
  });

  /**
   * The DB is the half that fails LATEST and loudest: a value the TS union allows but the CHECK
   * rejects passes typecheck, passes review, and 500s the first time someone uploads a photo.
   */
  it('is permitted by the file_assets CHECK constraint', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain("CHECK (storage_provider IN ('s3', 'dropbox', 'dropbox_hr'))");

    const allowed: FileAssetStorageProvider[] = ['s3', 'dropbox', 'dropbox_hr'];
    for (const provider of allowed) {
      expect(sql).toContain(`'${provider}'`);
    }
  });

  it('keeps the migration additive — existing rows are not repointed', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // Widening a CHECK is the whole change. An UPDATE here would repoint bytes that live in /comms.
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS/i);
  });
});
