/**
 * The ban-list WRITE-BACK — the half the credit platform does not do.
 *
 * The credit-platform team confirmed nothing over there adds to `blacklist_entries` on a decline. So a
 * Decline + Blacklist that stops at our own table bans the applicant on this desk and nowhere else,
 * and they come back through any other door. This is the writer, and these tests pin the three things
 * that decide whether a ban is actually effective:
 *
 *  1. It writes NORMALISED values, because the shared table has no normalisation of its own and the
 *     read probe normalises its needles — a raw value would file a ban our own Check A cannot find.
 *  2. It writes only the types the platform models, so no row is filed that nothing reads.
 *  3. It never throws. A credit platform that is down must cost the shared ban, not the decline.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('pg', () => ({
  default: { Pool: class { query = query; on() {} } },
}));

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...mod,
    env: {
      ...mod.env,
      VERIFICATION_WRITE_ENABLED: true,
      VERIFICATION_DATABASE_URL: 'postgres://writer@localhost:5432/credit_platform',
    },
  };
});

const { insertBanListEntries, isBanListWriteConfigured, BAN_ADDED_BY } = await import(
  '../../src/integrations/creditPlatformWriteDb.js'
);
const { canonicalCpType } = await import('../../src/integrations/creditPlatformBlacklist.js');

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
});

describe('the gate', () => {
  it('is open on its own switch, NOT the legacy desk write-back', async () => {
    // VERIFICATION_CP_WRITEBACK_ENABLED is hard-coded false — it governs `kxd.sales_agent_*`, a
    // system we no longer own. A confirmed fraud ban must not depend on reviving that.
    const { isWriteConfigured } = await import('../../src/integrations/creditPlatformWriteDb.js');
    expect(isWriteConfigured()).toBe(false);
    expect(isBanListWriteConfigured()).toBe(true);
  });
});

describe('the types it files', () => {
  it('maps our types to the ones the platform actually has', () => {
    expect(canonicalCpType('name')).toBe('name');
    expect(canonicalCpType('ein')).toBe('ein');
    expect(canonicalCpType('email')).toBe('email');
    expect(canonicalCpType('phone')).toBe('phone');
    expect(canonicalCpType('address')).toBe('address');
  });

  it('files nothing for the four types the platform does not model', () => {
    // `ssn`, `mc`, `usdot` and `ip` have no CP type. A row filed under an invented type would be a
    // ban nothing reads — worse than an honest absence, because the list would look complete.
    expect(canonicalCpType('ssn')).toBeNull();
    expect(canonicalCpType('mc')).toBeNull();
    expect(canonicalCpType('usdot')).toBeNull();
    expect(canonicalCpType('ip')).toBeNull();
  });

  it('picks ONE name type, so a banned name is not filed twice', () => {
    // Reading probes both `name` and `company_name`; writing to both would insert two rows for one
    // string, and `collectIdentifiers` cannot tell a company name from a person's anyway.
    expect(canonicalCpType('name')).toBe('name');
  });
});

describe('the insert', () => {
  it('is idempotent — never overwrites another team’s provenance', async () => {
    await insertBanListEntries([{ type: 'email', value: 'a@b.test', reason: 'fraud' }]);
    const [sql] = query.mock.calls[0]!;
    expect(sql).toMatch(/ON CONFLICT \(type, value\) DO NOTHING/i);
    expect(sql).not.toMatch(/DO UPDATE/i);
  });

  it('parameterises the values rather than interpolating them', async () => {
    await insertBanListEntries([
      { type: 'name', value: "o'brien trucking", reason: 'fraud' },
      { type: 'phone', value: '6145550110', reason: 'fraud' },
    ]);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('unnest($1::text[], $2::text[], $3::text[])');
    expect(sql).not.toContain("o'brien");
    expect(params[0]).toEqual(['name', 'phone']);
    expect(params[1]).toEqual(["o'brien trucking", '6145550110']);
  });

  it('stamps a source this desk can be identified by', async () => {
    await insertBanListEntries([{ type: 'ein', value: '123456789', reason: 'fraud' }]);
    const [, params] = query.mock.calls[0]!;
    expect(params[3]).toBe(BAN_ADDED_BY);
    // Distinguishable from the 6,802 `blocklist-import` rows already on the list.
    expect(BAN_ADDED_BY).not.toBe('blocklist-import');
  });

  it('counts only the rows that were new', async () => {
    query.mockResolvedValue({ rows: [{ id: 7 }] });
    const result = await insertBanListEntries([
      { type: 'email', value: 'a@b.test', reason: 'r' },
      { type: 'phone', value: '6145550110', reason: 'r' },
    ]);
    expect(result).toEqual({ available: true, attempted: 2, inserted: 1 });
  });

  it('sends one statement for many identifiers', async () => {
    await insertBanListEntries([
      { type: 'email', value: 'a@b.test', reason: 'r' },
      { type: 'phone', value: '6145550110', reason: 'r' },
      { type: 'name', value: 'acme llc', reason: 'r' },
    ]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not go to the database at all for an empty list', async () => {
    expect(await insertBanListEntries([])).toEqual({ available: true, attempted: 0, inserted: 0 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('when the platform is unreachable', () => {
  it('reports rather than throws — the decline must still land', async () => {
    query.mockRejectedValue(new Error('connection timeout'));
    const result = await insertBanListEntries([{ type: 'email', value: 'a@b.test', reason: 'r' }]);
    expect(result.available).toBe(false);
    expect(result.inserted).toBe(0);
    expect(result.error).toMatch(/timeout/);
  });

  it('never conflates "could not write" with "nothing to write"', async () => {
    query.mockRejectedValue(new Error('down'));
    const failed = await insertBanListEntries([{ type: 'email', value: 'a@b.test', reason: 'r' }]);
    const empty = await insertBanListEntries([]);
    expect(failed.available).toBe(false);
    expect(empty.available).toBe(true);
    // Both inserted zero. Only one of them is a problem.
    expect(failed.inserted).toBe(empty.inserted);
  });
});
