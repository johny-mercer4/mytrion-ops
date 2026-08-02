import { Readable } from 'node:stream';
import { env } from '../../../config/env.js';
import { AppError } from '../../../lib/errors.js';
import {
  dropboxDelete,
  dropboxDownload,
  dropboxDownloadStream,
  dropboxMetadata,
  dropboxTemporaryLink,
  dropboxUpload,
} from '../../../integrations/dropbox.js';
import type { ObjectStorage } from './types.js';

/**
 * Dropbox as an `ObjectStorage`, so comms attachments reuse the whole existing file pipeline.
 *
 * KEY vs PATH. Callers pass an S3-style key (`octane/threads/mth_x/report.pdf`); Dropbox needs an absolute
 * path (`/comms/octane/threads/mth_x/report.pdf`). The mapping is prefix-only and pure, so a key stored in
 * `file_assets.s3_key` resolves identically forever — which matters because a stored key is the only way
 * back to the bytes. Changing `DROPBOX_ROOT_PATH` after files exist would orphan them; it is deployment
 * config, not something to tune.
 *
 * `presignGet` is NOT a local signature like S3's. It is a network round trip to `get_temporary_link`, and
 * Dropbox decides the expiry (~4h) rather than honouring `ttlSeconds`. Callers that presign per row in a
 * list will therefore make one request per row — the list routes fetch links lazily for that reason.
 */

/** Dropbox rejects these in a path component; a user-supplied filename can contain any of them. */
const ILLEGAL_PATH_CHARS = /[\\:?*<>"|]/g;

/**
 * Key → Dropbox path.
 *
 * Every segment is sanitised and `..` is dropped, so a crafted key cannot climb out of the root prefix.
 * Attachment keys are server-generated today, but this function is the only thing standing between a key
 * and the filesystem-like namespace, so it must not assume that.
 */
export function keyToDropboxPath(key: string): string {
  const root = env.DROPBOX_ROOT_PATH.replace(/\/+$/, '') || '/comms';
  const segments = key
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
    .map((s) => s.replace(ILLEGAL_PATH_CHARS, '_'))
    // Dropbox rejects a trailing dot or space on a component.
    .map((s) => s.replace(/[. ]+$/, ''))
    .filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new AppError('Refusing to build a Dropbox path from an empty key.', {
      statusCode: 500,
      code: 'DROPBOX_BAD_KEY',
    });
  }
  return `${root.startsWith('/') ? root : `/${root}`}/${segments.join('/')}`;
}

export const dropboxStorage: ObjectStorage = {
  async put(key, body, _opts) {
    // Dropbox stores no content type — it infers one from the extension on download. The MIME the caller
    // supplied is kept on the `file_assets` row instead, which is where every reader already looks.
    await dropboxUpload(keyToDropboxPath(key), body, { mode: 'overwrite' });
  },

  async getStream(key) {
    const { body, size } = await dropboxDownloadStream(keyToDropboxPath(key));
    return {
      // Readable.fromWeb needs the DOM ReadableStream type; the runtime object is the same one.
      body: Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      ...(size === undefined ? {} : { contentLength: size }),
    };
  },

  async getBuffer(key, maxBytes) {
    // Both guards, deliberately: `dropboxDownload` checks metadata BEFORE fetching so an oversized file is
    // never buffered, and the post-read check below catches a file that grew between the two calls. The S3
    // adapter has the same pair, and dropping either would make this provider the weaker one.
    const { body } = await dropboxDownload(keyToDropboxPath(key), maxBytes);
    if (body.length > maxBytes) {
      throw new AppError(`File is larger than the ${maxBytes}-byte limit for this operation.`, {
        statusCode: 413,
        code: 'FILE_TOO_LARGE',
        expose: true,
      });
    }
    return body;
  },

  async presignGet(key, _opts) {
    // `ttlSeconds` and `filename` are ignored: Dropbox owns the expiry, and the download name comes from
    // the stored path. Accepting them silently is the interface's contract — a caller that needs an exact
    // TTL or a Content-Disposition must proxy the bytes through the download route instead.
    const { url, expiresAt } = await dropboxTemporaryLink(keyToDropboxPath(key));
    return { url, expiresAt };
  },

  async delete(key) {
    await dropboxDelete(keyToDropboxPath(key));
  },
};

/** Byte size without downloading — used to reconcile a stored size against Dropbox. */
export async function dropboxSize(key: string): Promise<number> {
  const meta = await dropboxMetadata(keyToDropboxPath(key));
  return meta.size;
}
