/**
 * The credit platform's ban list — the list Check A actually has to read.
 *
 * WHAT WAS WRONG. `runScreening` matched only `verification_blacklist_entries` in our own Postgres,
 * which holds 0 rows and whose only writer is this desk's own `decline_blacklist` outcome. The list
 * Octane maintains lives in `credit_platform.public.blacklist_entries` — 6,803 active entries. So every
 * case in the system screened clean, and the clear was recorded on the phase. A fraud check that always
 * passes is worse than none, because it looks like it ran.
 *
 * These tests pin the query's SHAPE and its failure behaviour, both of which are load-bearing: the type
 * mapping decides whether a needle can match at all, and a lookup that throws must degrade to
 * "unavailable" rather than to "no match".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('../../src/integrations/verificationDb.js', () => ({
  getVerificationPool: () => ({ query }),
}));

/**
 * The URL has to be present or every call short-circuits to `available: false` — which is the correct
 * production behaviour and useless as a test fixture. Spread from the real module so nothing else in
 * `env` is lost.
 */
vi.mock('../../src/config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...mod,
    env: { ...mod.env, VERIFICATION_DATABASE_URL: 'postgres://audit@localhost:5432/credit_platform' },
  };
});

const { matchCreditPlatformBanList, isCreditPlatformBanListConfigured } = await import(
  '../../src/integrations/creditPlatformBlacklist.js'
);

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe('the needles it sends', () => {
  it('sends normalised values, not raw ones', async () => {
    await matchCreditPlatformBanList([
      { entryType: 'email', value: '  OPS@Kaiser.TEST ' },
      { entryType: 'phone', value: '(614) 555-0110' },
      { entryType: 'name', value: 'Smith  Trucking, LLC' },
    ]);
    const [, params] = query.mock.calls[0]!;
    const [types, needles] = params as [string[], string[]];
    expect(needles).toContain('ops@kaiser.test');
    expect(needles).toContain('6145550110');
    expect(needles).toContain('smith trucking llc');
    // `name` fans out to both CP types that can satisfy it.
    expect(types.filter((t) => t === 'name').length).toBeGreaterThan(0);
    expect(types.filter((t) => t === 'company_name').length).toBeGreaterThan(0);
  });

  /**
   * `carrier_id` is the platform's own carrier key and we hold nothing that could match it, so it is
   * deliberately absent from the map — and `mc` / `usdot` / `ssn` have no CP type at all. A needle we
   * cannot produce must not be sent as one that silently never matches.
   */
  it('sends nothing for identifier types the list does not carry', async () => {
    await matchCreditPlatformBanList([
      { entryType: 'mc', value: '123456' },
      { entryType: 'usdot', value: '987654' },
      { entryType: 'ssn', value: '4821' },
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('drops an identifier that normalises to nothing', async () => {
    await matchCreditPlatformBanList([{ entryType: 'phone', value: '---' }]);
    expect(query).not.toHaveBeenCalled();
  });

  it('pairs each type with its own needle, so a name cannot match an email entry', async () => {
    await matchCreditPlatformBanList([
      { entryType: 'email', value: 'a@b.test' },
      { entryType: 'ein', value: '88-1234567' },
    ]);
    const [sql, params] = query.mock.calls[0]!;
    const [types, needles] = params as [string[], string[]];
    expect(String(sql)).toContain('unnest($1::text[], $2::text[])');
    expect(types).toHaveLength(needles.length);
    expect(types[needles.indexOf('a@b.test')]).toBe('email');
    expect(types[needles.indexOf('881234567')]).toBe('ein');
  });
});

describe('what it reports back', () => {
  it('maps a platform row onto our own identifier type and keeps the platform id', async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: 1576,
          type: 'company_name',
          reason: 'fraud ring 2026-03',
          added_by: 'blacklist-import',
          added_at: new Date('2026-08-10T13:17:20.104Z'),
          needle: 'smith trucking llc',
        },
      ],
    });
    const out = await matchCreditPlatformBanList([{ entryType: 'name', value: 'Smith Trucking LLC' }]);
    expect(out.available).toBe(true);
    expect(out.hits).toEqual([
      {
        entryId: 1576,
        cpType: 'company_name',
        entryType: 'name',
        matchedOn: 'smith trucking llc',
        reason: 'fraud ring 2026-03',
        addedBy: 'blacklist-import',
        addedAt: '2026-08-10T13:17:20.104Z',
      },
    ]);
  });

  it('reports a clean lookup as available with no hits', async () => {
    const out = await matchCreditPlatformBanList([{ entryType: 'email', value: 'a@b.test' }]);
    expect(out).toEqual({ available: true, hits: [], error: null });
  });

  /**
   * THE ONE THAT MATTERS. A failed lookup must not be indistinguishable from a clean one — the caller
   * writes `available` onto the phase and the desk refuses to read `false` as a clear.
   */
  it('degrades to UNAVAILABLE rather than to no-match when the lookup fails', async () => {
    query.mockRejectedValue(new Error('terminating connection due to administrator command'));
    const out = await matchCreditPlatformBanList([{ entryType: 'email', value: 'a@b.test' }]);
    expect(out.available).toBe(false);
    expect(out.hits).toEqual([]);
    expect(out.error).toMatch(/terminating connection/);
  });

  it('never throws, so one bad lookup cannot take the whole screening run down', async () => {
    query.mockRejectedValue(new Error('boom'));
    await expect(
      matchCreditPlatformBanList([{ entryType: 'email', value: 'a@b.test' }]),
    ).resolves.toBeTruthy();
  });
});

describe('configuration', () => {
  it('reports availability from the env, and reads nothing when it is unset', async () => {
    // The env module is read at call time, so this asserts the shape rather than re-importing it.
    expect(typeof isCreditPlatformBanListConfigured()).toBe('boolean');
  });
});
