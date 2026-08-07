import 'dotenv/config';
/**
 * Live smoke test for Dropbox storage — proves the configured credentials can actually round-trip a file
 * through the same `ObjectStorage` adapter the app uses.
 *
 *   pnpm dropbox:smoke
 *
 * Exercises the real upload → metadata → temporary-link → download → delete path against the Dropbox API,
 * going through `dropboxStorage` rather than the raw client so the key→path mapping is covered too.
 *
 * SKIPs (exit 0) when Dropbox isn't configured; exits 1 if any step fails.
 *
 * WRITES AND THEN DELETES one small file under `<DROPBOX_ROOT_PATH>/_smoke/`. The key is timestamped, so a
 * concurrent run cannot clobber another's file, and the delete is in a `finally` so a mid-test failure does
 * not leave the object behind.
 */
import { env } from '../src/config/env.js';
import { dropboxConfigured } from '../src/integrations/dropbox.js';
import { dropboxStorage, keyToDropboxPath } from '../src/modules/files/storage/dropboxStorage.js';

/* eslint-disable no-console */

const PAYLOAD = Buffer.from(`octane dropbox smoke ${new Date().toISOString()}\n`, 'utf8');

async function main(): Promise<number> {
  console.log('\n  Dropbox storage smoke test\n  ' + '─'.repeat(52));

  if (!dropboxConfigured()) {
    console.log('  ⚪️  SKIP — DROPBOX_APP_KEY / _APP_SECRET / _REFRESH_TOKEN not all set');
    return 0;
  }

  // Timestamp, not a random id: the scripts in this repo run under `tsx` where a stable, sortable name
  // makes an orphaned file (if a hard kill skips the cleanup) obvious to find and remove by hand.
  const key = `_smoke/${new Date().toISOString().replace(/[:.]/g, '-')}/smoke.txt`;
  console.log(`  root   ${env.DROPBOX_ROOT_PATH}`);
  console.log(`  path   ${keyToDropboxPath(key)}`);
  console.log(`  files  provider=${env.FILE_STORAGE_PROVIDER}  comms provider=${env.COMMS_STORAGE_PROVIDER}`);
  console.log('  ' + '─'.repeat(52));

  let failed = false;
  let uploaded = false;

  const step = async (label: string, fn: () => Promise<string>): Promise<void> => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      console.log(`  ✅  ${label.padEnd(16)} ${String(Date.now() - t0).padStart(5)}ms  ${detail}`);
    } catch (err) {
      failed = true;
      console.log(
        `  ❌  ${label.padEnd(16)} ${String(Date.now() - t0).padStart(5)}ms  ` +
          (err instanceof Error ? err.message.slice(0, 220) : String(err)),
      );
    }
  };

  try {
    await step('put', async () => {
      await dropboxStorage.put(key, PAYLOAD, { contentType: 'text/plain' });
      uploaded = true;
      return `${PAYLOAD.length} bytes uploaded`;
    });

    // Everything below needs the object to exist; without the upload they would fail for the wrong reason
    // and the output would point at the wrong step.
    if (uploaded) {
      await step('presignGet', async () => {
        const { url, expiresAt } = await dropboxStorage.presignGet(key);
        if (!/^https:\/\//.test(url)) throw new Error(`temporary link was not https: ${url.slice(0, 60)}`);
        return `link ok, expires ${expiresAt.toISOString()}`;
      });

      await step('getBuffer', async () => {
        const got = await dropboxStorage.getBuffer(key, 1024 * 1024);
        // Byte-for-byte, not just length: a length check would pass on a truncated-then-padded read, and
        // silent corruption is the failure this smoke test exists to catch.
        if (!got.equals(PAYLOAD)) {
          throw new Error(`downloaded bytes differ (got ${got.length}, expected ${PAYLOAD.length})`);
        }
        return `${got.length} bytes match the upload`;
      });

      await step('getStream', async () => {
        const { body, contentLength } = await dropboxStorage.getStream(key);
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
        const streamed = Buffer.concat(chunks);
        if (!streamed.equals(PAYLOAD)) throw new Error('streamed bytes differ from the upload');
        return `${streamed.length} bytes streamed (content-length ${contentLength ?? 'absent'})`;
      });

      await step('getBuffer cap', async () => {
        // The memory guardrail must REJECT, not truncate. A provider that ignores maxBytes is how the parse
        // path OOMs on a large file.
        try {
          await dropboxStorage.getBuffer(key, 4);
          throw new Error('a 4-byte cap did not reject a larger file');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/did not reject/.test(message)) throw err;
          return 'oversized read correctly rejected';
        }
      });
    }
  } finally {
    if (uploaded) {
      await step('delete', async () => {
        await dropboxStorage.delete(key);
        return 'cleaned up';
      });
      // Delete is documented as idempotent — a retried cleanup must not fail. Cheap to prove here.
      await step('delete again', async () => {
        await dropboxStorage.delete(key);
        return 'idempotent on a missing path';
      });
    }
  }

  console.log('  ' + '─'.repeat(52));
  console.log(failed ? '  ❌  FAILED\n' : '  ✅  Dropbox storage round-trip OK\n');
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
