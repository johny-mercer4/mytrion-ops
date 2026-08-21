import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_CHECKS,
  authorityCanPass,
  authorityChecklistLines,
  authorityRunFrom,
  authoritySuggestionsFromRun,
  authorityUnreachable,
  missingAuthorityDocs,
} from './caseAuthority';

describe('authorityCanPass', () => {
  it('requires every authority check OK and no structure still needed', () => {
    expect(authorityCanPass({ checks: {}, relatedCompany: null, thirdParty: null })).toBe(false);
    const checks = Object.fromEntries(AUTHORITY_CHECKS.map((c) => [c.id, 'ok' as const]));
    expect(authorityCanPass({ checks, relatedCompany: null, thirdParty: null })).toBe(true);
    expect(authorityCanPass({ checks, relatedCompany: 'needed', thirdParty: null })).toBe(false);
    expect(authorityCanPass({ checks, relatedCompany: 'na', thirdParty: 'ok' })).toBe(true);
    expect(
      authorityCanPass({
        checks: { ...checks, insurance: 'inactive' },
        relatedCompany: null,
        thirdParty: null,
      }),
    ).toBe(false);
  });
});

describe('missingAuthorityDocs', () => {
  it('maps missing checks and needed structure onto existing document types', () => {
    expect(
      missingAuthorityDocs({
        checks: { insurance: 'missing', mc: 'inactive' },
        relatedCompany: 'needed',
        thirdParty: 'needed',
      }),
    ).toEqual([
      { docType: 'insurance', label: 'Insurance certificate' },
      { docType: 'corporate_guarantee', label: 'Corporate guarantee' },
      { docType: 'lease_agreement', label: 'Lease agreement' },
      { docType: 'other', label: 'Unit information' },
    ]);
  });
});

describe('authorityChecklistLines', () => {
  it('lists the carrier SOP checks', () => {
    const lines = authorityChecklistLines();
    expect(lines).toContain('MC status');
    expect(lines).toContain('Related-company structure — Corporate Guarantee');
  });
});

/**
 * THE REGISTER RUN, and the rule that matters more than any single suggestion: a mark of `ok` is a
 * CLEAR, and a clear may only come from a source that actually answered. Off-Render the FMCSA register
 * is denied at the edge, so these paths are the NORMAL ones in development, not edge cases.
 */
describe('the authority run', () => {
  const NOW = Date.parse('2026-08-20T12:00:00Z');

  const run = (over: Record<string, unknown> = {}) => ({
    ranAt: '2026-08-20T09:00:00.000Z',
    keys: { dot: '158121', mc: null, carrierDot: null, authorityNumbersIdentical: false, carrierDotDisagrees: false },
    register: { source: 'fmcsa.qcmobile', available: false, error: 'HTTP 403', reason: 'blocked', notFound: false, matchedOn: null, carrier: null, candidates: [], candidatesTruncated: false, retrievalDate: null },
    operatingAuthority: { source: 'fmcsa.qcmobile/authority', available: false, error: 'HTTP 403', records: [] },
    census: { source: 'socrata.az4n-8mr2', frozen: false, available: true, error: null, record: { statusCode: 'A', statusLabel: 'Active', powerUnits: 12, addDate: '2019-04-02', dockets: [{ prefix: 'MC', number: '778211', statusCode: 'A', statusLabel: 'Active' }] } },
    insurance: { source: 'socrata.qh9u-swkp', frozen: true, dataAsOf: '2026-05-14', available: true, error: null, bipdActive: 1, bipdCoverageDollars: 1_000_000, filings: [] },
    ...over,
  });

  it('reads nothing out of findings with no run', () => {
    expect(authorityRunFrom(null)).toBeNull();
    expect(authorityRunFrom({})).toBeNull();
    expect(authorityRunFrom({ census: { available: true } })).toBeNull();
  });

  /** The everyday development case: FMCSA denied, Socrata answering. */
  it('suggests USDOT, operating authority, MC and age from the census when the register is blocked', () => {
    const out = authoritySuggestionsFromRun(authorityRunFrom(run()), NOW);
    expect(out.dot).toMatchObject({ mark: 'ok' });
    expect(out.operating).toMatchObject({ mark: 'ok' });
    expect(out.mc?.mark).toBe('ok');
    expect(out.mc?.because).toContain('778211');
    expect(out.authority_age?.mark).toBe('ok');
  });

  /**
   * INSURANCE IS THE ONE THE CENSUS CANNOT ANSWER. The Socrata insurance feed is frozen and 4.7% of the
   * carriers it calls insured have already passed their cancellation date, so it may inform but must
   * never suggest. With the register blocked, insurance gets NO suggestion at all.
   */
  it('never suggests insurance from the frozen feed, only from the live register', () => {
    expect(authoritySuggestionsFromRun(authorityRunFrom(run()), NOW).insurance).toBeUndefined();

    const live = run({
      register: {
        available: true, error: null, reason: null, notFound: false, matchedOn: 'dot',
        candidates: [], candidatesTruncated: false, retrievalDate: null,
        carrier: { statusCode: 'A', status: 'active', allowedToOperate: 'yes', totalPowerUnits: 213, legalName: 'VERIHA TRUCKING INC', insurance: { bipd: { dollars: 1_000_000, onFile: true } } },
      },
    });
    expect(authoritySuggestionsFromRun(authorityRunFrom(live), NOW).insurance).toMatchObject({ mark: 'ok' });
  });

  /** `"0"` on the wire means REQUIRED BUT NOTHING FILED — a finding, not an absence. */
  it('reads no BIPD on file as an INACTIVE finding, not as a missing answer', () => {
    const uninsured = run({
      register: {
        available: true, error: null, reason: null, notFound: false, matchedOn: 'dot',
        candidates: [], candidatesTruncated: false, retrievalDate: null,
        carrier: { statusCode: 'A', status: 'active', allowedToOperate: 'yes', insurance: { bipd: { dollars: 0, onFile: false } } },
      },
    });
    expect(authoritySuggestionsFromRun(authorityRunFrom(uninsured), NOW).insurance).toMatchObject({
      mark: 'inactive',
    });
  });

  it('suggests NOTHING for a check whose only source went quiet', () => {
    const dark = run({
      census: { available: false, error: 'ETIMEDOUT', record: null },
      insurance: { available: false, error: 'ETIMEDOUT', frozen: true, dataAsOf: '2026-05-14', bipdActive: 0, bipdCoverageDollars: null, filings: [] },
    });
    expect(authoritySuggestionsFromRun(authorityRunFrom(dark), NOW)).toEqual({});
  });

  /** "Operating history" is a judgement, not a field in any of the four sources. */
  it('never suggests operating history from anything', () => {
    expect(authoritySuggestionsFromRun(authorityRunFrom(run()), NOW).history).toBeUndefined();
  });

  it('names every unreachable source with what its absence costs', () => {
    const out = authorityUnreachable(authorityRunFrom(run()));
    expect(out.map((s) => s.id)).toEqual(['register']);
    // The edge deny in particular must not read as a fact about the carrier.
    expect(out[0]!.detail).toMatch(/denied at the FMCSA edge/);
  });

  it('reports an inactive census status as a finding rather than a clear', () => {
    const inactive = run({
      census: { available: true, error: null, record: { statusCode: 'I', statusLabel: 'Inactive', powerUnits: 0, addDate: '2001-01-01', dockets: [] } },
    });
    const out = authoritySuggestionsFromRun(authorityRunFrom(inactive), NOW);
    expect(out.dot).toMatchObject({ mark: 'inactive' });
    // No docket at all means no MC suggestion — a fabricated one would be worse than none.
    expect(out.mc).toBeUndefined();
  });
});
