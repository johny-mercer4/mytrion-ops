/**
 * The warehouse is READ-ONLY to this application.
 *
 * Octane is a read-only consumer of the DWH — it is someone else's system of record. Mytrion Watch
 * reads features from it and writes every result to our OWN Postgres. This pins that, because the
 * failure mode is silent and expensive: a stray INSERT would either fail in production against a
 * read-only grant, or worse, succeed against a schema nobody expected us to mutate.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src/', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);
const source = (f: string): string => readFileSync(f, 'utf8');

/** Schemas that live in the warehouse. Ours is plain `public` on a different connection. */
const DWH_SCHEMAS = ['octane', 'dbt', 'verification_staging', 'verification_public', 'octane_public'];

describe('the DWH is read-only', () => {
  it('exposes only a query method, never a write one', () => {
    const dwhModule = source(join(SRC, 'integrations/dwh.ts'));
    expect(dwhModule).toMatch(/async query</);
    // If a write helper is ever added here, every call site below becomes unaudited.
    expect(dwhModule).not.toMatch(/async (insert|update|delete|upsert|write)\b/);
  });

  it('has no INSERT / UPDATE / DELETE aimed at a warehouse schema', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = source(file);
      for (const schema of DWH_SCHEMAS) {
        const write = new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+${schema}\\.`, 'i');
        if (write.test(text)) offenders.push(`${file.replace(SRC, '')} -> ${schema}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps Mytrion Watch reading the warehouse and writing only our own tables', () => {
    const service = source(join(SRC, 'modules/mytrionWatch/watchService.ts'));
    // Features come from the DWH...
    expect(service).toMatch(/dwh\.query</);
    // ...and every persisted row goes through our own repo, never the warehouse connection.
    expect(service).toMatch(/mytrionWatchRepo\.upsertScores/);
    expect(service).not.toMatch(/dwh\.(insert|update|delete|execute)/);
  });
});
