/**
 * Dropbox adapter — path mapping, provider selection, and the header escaping.
 *
 * These are the parts that are wrong-forever if wrong once. A stored key is the ONLY route back to the
 * bytes, so `keyToDropboxPath` must be pure and stable; and `storageFor` deciding by row rather than by env
 * is what stops a Dropbox rollout from 404-ing every file already on S3.
 *
 * No network: the HTTP layer needs live Dropbox credentials and is exercised by the manual check documented
 * in WORKING_NOTES, not here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DROPBOX_ROOT_PATH = '/comms';
});

import { keyToDropboxPath } from '../../src/modules/files/storage/dropboxStorage.js';
import { dropboxInternals } from '../../src/integrations/dropbox.js';
import {
  getStorage,
  setStorageForTests,
  storageFor,
} from '../../src/modules/files/storage/index.js';
import { s3Storage } from '../../src/modules/files/storage/s3Storage.js';
import { dropboxStorage } from '../../src/modules/files/storage/dropboxStorage.js';

afterEach(() => {
  setStorageForTests(null);
});

describe('keyToDropboxPath — a stored key must resolve to the same path forever', () => {
  it('prefixes the root and keeps the key structure', () => {
    expect(keyToDropboxPath('octane/upload/2026-08/f1/report.pdf')).toBe(
      '/comms/octane/upload/2026-08/f1/report.pdf',
    );
  });

  it('is deterministic — the same key always yields the same path', () => {
    const key = 'octane/upload/2026-08/f1/report.pdf';
    expect(keyToDropboxPath(key)).toBe(keyToDropboxPath(key));
  });

  it('DROPS `..` so a crafted key cannot climb out of the root prefix', () => {
    // Attachment keys are server-generated today, but this function is the only thing between a key and a
    // filesystem-like namespace, so it must not assume that.
    expect(keyToDropboxPath('octane/../../etc/passwd')).toBe('/comms/octane/etc/passwd');
    expect(keyToDropboxPath('../../../secret.txt')).toBe('/comms/secret.txt');
  });

  it('collapses empty segments rather than emitting a double slash', () => {
    expect(keyToDropboxPath('octane//upload///f1/a.pdf')).toBe('/comms/octane/upload/f1/a.pdf');
  });

  it('replaces characters Dropbox rejects in a path', () => {
    // A user-supplied filename can contain any of these; Dropbox 400s on them.
    expect(keyToDropboxPath('octane/upload/we:ird?name*.pdf')).toBe(
      '/comms/octane/upload/we_ird_name_.pdf',
    );
    expect(keyToDropboxPath('octane/upload/a<b>c|d"e.pdf')).toBe('/comms/octane/upload/a_b_c_d_e.pdf');
  });

  it('strips a trailing dot or space from a component — Dropbox rejects both', () => {
    expect(keyToDropboxPath('octane/upload/name. ')).toBe('/comms/octane/upload/name');
  });

  it('keeps unicode filenames intact — only illegal characters are touched', () => {
    expect(keyToDropboxPath('octane/upload/счёт-2026.pdf')).toBe('/comms/octane/upload/счёт-2026.pdf');
  });

  it('refuses an empty key rather than writing to the root', () => {
    expect(() => keyToDropboxPath('')).toThrow(/empty key/i);
    expect(() => keyToDropboxPath('///')).toThrow(/empty key/i);
    expect(() => keyToDropboxPath('..')).toThrow(/empty key/i);
  });
});

describe('storageFor — the ROW decides, not the env', () => {
  it("resolves 's3' and 'dropbox' to their own adapters", () => {
    expect(storageFor('s3')).toBe(s3Storage);
    expect(storageFor('dropbox')).toBe(dropboxStorage);
  });

  it('treats a null/undefined provider as S3 — every pre-Dropbox row is there', () => {
    expect(storageFor(null)).toBe(s3Storage);
    expect(storageFor(undefined)).toBe(s3Storage);
  });

  it('falls back to S3 for an UNKNOWN provider instead of throwing', () => {
    // The value can only come from a database column, and a row written by a newer deploy must not make an
    // older one crash on read: a 404 from the wrong store is recoverable, a boot loop is not.
    expect(storageFor('gdrive')).toBe(s3Storage);
  });

  it('the default pipeline is still S3, so nothing existing moves', () => {
    expect(getStorage()).toBe(s3Storage);
  });

  it('the test override wins for both entry points', () => {
    const fake = { put: vi.fn() } as unknown as typeof s3Storage;
    setStorageForTests(fake);
    expect(getStorage()).toBe(fake);
    expect(storageFor('dropbox')).toBe(fake);
  });
});

describe('Dropbox-API-Arg escaping', () => {
  const { apiArg } = dropboxInternals;

  it('leaves ASCII JSON untouched', () => {
    expect(apiArg({ path: '/comms/a.pdf' })).toBe('{"path":"/comms/a.pdf"}');
  });

  it('escapes non-ASCII as \\uXXXX so the HTTP header stays valid', () => {
    // A Cyrillic or emoji filename would otherwise produce an invalid header and an opaque Dropbox 400.
    expect(apiArg({ path: '/comms/счёт.pdf' })).toBe(
      '{"path":"/comms/\\u0441\\u0447\\u0451\\u0442.pdf"}',
    );
    expect(apiArg({ n: '🚚' })).toMatch(/^\{"n":"\\u[0-9a-f]{4}\\u[0-9a-f]{4}"\}$/);
  });

  it('produces header-safe output for every non-ASCII input', () => {
    const out = apiArg({ path: '/comms/naïve—ünïcode.pdf' });
    // eslint-disable-next-line no-control-regex
    expect(/[^\x20-\x7e]/.test(out)).toBe(false);
  });
});

describe('retry backoff', () => {
  const { retryDelayMs } = dropboxInternals;
  const withHeader = (v: string | null): Response =>
    ({ headers: { get: () => v } }) as unknown as Response;

  it('honours Retry-After in whole seconds', () => {
    expect(retryDelayMs(withHeader('2'), 0)).toBe(2000);
  });

  it('caps a hostile Retry-After so a 429 cannot stall a request for an hour', () => {
    expect(retryDelayMs(withHeader('3600'), 0)).toBe(30_000);
  });

  it('backs off exponentially, bounded, when the header is absent or junk', () => {
    expect(retryDelayMs(withHeader(null), 0)).toBe(500);
    expect(retryDelayMs(withHeader(null), 1)).toBe(1000);
    expect(retryDelayMs(withHeader('soon'), 2)).toBe(2000);
    expect(retryDelayMs(withHeader(null), 20)).toBe(8000);
  });

  it('accepts Retry-After: 0 rather than falling through to a backoff', () => {
    expect(retryDelayMs(withHeader('0'), 3)).toBe(0);
  });
});

describe('size thresholds', () => {
  it('switches to a chunked session below the 150MB vendor hard limit', () => {
    // Sitting at the vendor limit means the first oversized production file discovers it.
    expect(dropboxInternals.SINGLE_SHOT_LIMIT).toBeLessThan(150 * 1024 * 1024);
    expect(dropboxInternals.CHUNK_BYTES).toBeLessThanOrEqual(dropboxInternals.SINGLE_SHOT_LIMIT);
  });
});
