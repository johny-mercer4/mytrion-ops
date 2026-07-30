import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_LOADER_TABLES } from '../../src/modules/dataLoader/allowlist.js';

const roleSql = readFileSync(resolve('scripts/nocodb-role.sql'), 'utf8');
const migrationSql = readFileSync(
  resolve('src/db/migrations/0069_data_loader_journal.sql'),
  'utf8',
);

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe('Data Loader allowlist safety invariant', () => {
  it('keeps writable grants, trigger attachments, and the application list identical', () => {
    const grants = [
      ...roleSql.matchAll(
        /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.([a-z_]+) TO mytrion_loader;/g,
      ),
    ].map((match) => match[1] ?? '');
    const triggers = [
      ...migrationSql.matchAll(/CREATE TRIGGER data_loader_journal_([a-z_]+)/g),
    ].map((match) => match[1] ?? '');

    expect(sorted(grants)).toEqual(sorted(DATA_LOADER_TABLES));
    expect(sorted(triggers)).toEqual(sorted(DATA_LOADER_TABLES));
  });

  it('enables a loader-specific RLS policy on every writable table', () => {
    for (const table of DATA_LOADER_TABLES) {
      expect(roleSql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(roleSql).toContain(`mytrion_loader_tenant ON public.${table}`);
    }
  });

  it('revokes schema creation and never grants access-control or audit tables', () => {
    expect(roleSql).toContain('REVOKE CREATE ON SCHEMA public FROM mytrion_loader;');
    expect(roleSql).toContain(
      'GRANT REFERENCES ON ALL TABLES IN SCHEMA public TO mytrion_loader;',
    );
    expect(roleSql).not.toContain('GRANT SELECT ON ALL TABLES IN SCHEMA public');
    expect(roleSql).not.toMatch(/GRANT .*public\.audit_log TO mytrion_loader/);
    expect(roleSql).not.toMatch(/GRANT .*public\.worker_mytrion_access TO mytrion_loader/);
    expect(roleSql).not.toMatch(/GRANT .*public\.mytrion_profile_defaults TO mytrion_loader/);
    expect(roleSql).not.toMatch(/GRANT .*public\.mytrion_role_defaults TO mytrion_loader/);
  });
});
