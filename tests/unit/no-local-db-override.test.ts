/**
 * ONE DATABASE, EVERY ENVIRONMENT — including localhost.
 *
 * A `LOCAL_OPS_DATABASE_URL` used to redirect the app database in development. It cost three
 * separate false diagnoses in a single day:
 *
 *   1. A repair script reported "scored 716" five times and changed nothing in prod.
 *   2. A 503 was blamed on an unmigrated prod database that was in fact already migrated.
 *   3. A filter was reported as broken when it was reading an empty local snapshot.
 *
 * Every one of those looked like a bug in the code and was a bug in which database was being read.
 * The override is gone; this keeps it gone, because it is the kind of convenience that gets
 * reintroduced by someone who has not paid for it yet.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url).pathname, 'utf8');

describe('there is no local database override', () => {
  it('resolves the app database from one variable, with no environment branch', () => {
    const env = read('../../src/config/env.ts');
    expect(env).toMatch(
      /export const databaseUrl: string = env\.MYTRION_OPS_DATABASE_URL \|\| env\.DATABASE_URL;/,
    );
    // No conditional, no dev-only flag feeding the resolution.
    expect(env).not.toMatch(/usingLocalOpsDatabase/);
    expect(env).not.toMatch(/LOCAL_OPS_DATABASE_URL:\s*z\./);
  });

  it('ships no script or default that points the app at a local database', () => {
    const pkg = read('../../package.json');
    expect(pkg).not.toMatch(/LOCAL_OPS_DATABASE_URL/);
    expect(pkg).not.toMatch(/dev:local-db/);
  });

  it('never advertises a local database in an operator-facing error', () => {
    // These messages are what someone reads at 2am when the desk is down. Telling them to point at
    // a different database is how the wrong database gets used in the first place.
    for (const f of [
      '../../src/modules/verification/verificationCases.ts',
      '../../src/modules/verification/carrierAttachmentService.ts',
    ]) {
      expect(read(f)).not.toMatch(/dev:local-db|LOCAL_OPS_DATABASE_URL/);
    }
  });
});
