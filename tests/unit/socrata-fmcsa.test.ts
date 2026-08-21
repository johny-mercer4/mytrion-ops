/**
 * Socrata (data.transportation.gov) — Phase 4's only reachable FMCSA source, and a minefield.
 *
 * WHY THESE TESTS EXIST AT ALL. Every trap in this source fails the same way: HTTP 200 with an empty or
 * inverted answer. A bare `dot_number = '652739'` matches 0 of 467,983 insurance rows because the
 * column is zero-padded text; `effective_date > '2026-01-01'` matches 0 rows because the column is
 * `MM/DD/YYYY` text compared lexicographically; `$order=trans_date DESC` returns a 1996 filing as the
 * newest because it sorts by month. None of those raise, none of them log, and each one turns a
 * compliance check into a confident clear. So the assertions below pin the QUERY TEXT, not just the
 * parsed output — the query text is where the silence is manufactured.
 *
 * The transport is mocked, never the module: `fetch` is stubbed so the exact URL we would have sent is
 * observable, which is the only place a re-introduced trap is visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

/**
 * An app token is OPTIONAL here — anonymous access works and this deployment carries none. It is held
 * behind a getter so one test can set it without a second module registry; the module reads `env` at
 * call time. Spread from the real module so nothing else in `env` (the outbound timeout, above all) is
 * lost.
 */
let appToken = '';
vi.mock('../../src/config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...mod,
    env: {
      ...mod.env,
      SOCRATA_BASE_URL: 'https://data.transportation.gov',
      get SOCRATA_APP_TOKEN(): string {
        return appToken;
      },
    },
  };
});

// THREE MODULES, ONE SUITE, and the split is the point: `socrataClient` is the shared transport,
// `socrataFmcsa` the LIVE census, `socrataFmcsaFilings` the two FROZEN feeds. Importing them
// separately here keeps the freshness distinction visible in the test file too.
const { isSocrataConfigured, SOCRATA_FROZEN_AS_OF } = await import(
  '../../src/integrations/socrataClient.js'
);
const { fetchCensusByDot, searchCensusByName } = await import(
  '../../src/integrations/socrataFmcsa.js'
);
const { fetchInsuranceByDot, fetchProcessAgentsByDot } = await import(
  '../../src/integrations/socrataFmcsaFilings.js'
);

/** Socrata answers `[]` + HTTP 200 for "no such row" — the empty answer, not a failure. */
const ok = (rows: unknown[]) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(rows),
});

/** A broken query: HTTP 400 with a JSON `errorCode`. The only thing that means "unavailable". */
const soqlError = (errorCode: string) => ({
  ok: false,
  status: 400,
  text: async () =>
    JSON.stringify({ message: `Query coordinator error: ${errorCode}`, errorCode }),
});

/** The URL the module would have sent, as a parsed URL. */
const sentUrl = (call = 0): URL => new URL(String(fetchMock.mock.calls[call]![0]));
const param = (key: string, call = 0): string => sentUrl(call).searchParams.get(key) ?? '';
const headers = (call = 0): Record<string, string> => {
  const init = fetchMock.mock.calls[call]![1] as { headers?: Record<string, string> } | undefined;
  return init?.headers ?? {};
};

/** A real census row for DOT 652739, exactly as the live API returned it today. */
const CENSUS_ROW = {
  dot_number: '652739',
  legal_name: 'STONE EXPRESS INC',
  status_code: 'A',
  add_date: '19960731',
  carrier_operation: 'A',
  power_units: '7',
  total_drivers: '5',
  docket1prefix: 'MC',
  docket1: '307348',
  docket1_status_code: 'A',
  phy_street: '99 DELL GLEN AVE',
  phy_city: 'LODI',
  phy_state: 'NJ',
  phy_zip: '07644',
  phone: '9737672454',
};

/** The newest BIPD filing for the same DOT, verbatim. Note there is NO `cancl_effective_date` key. */
const INSURANCE_ROW = {
  docket_number: 'MC307348',
  dot_number: '00652739',
  ins_form_code: '91X',
  mod_col_1: 'BIPD/Primary',
  name_company: 'PRIME PROPERTY & CASUALTY INSURANCE INC',
  policy_no: 'PC25120208',
  trans_date: '12/15/2025',
  underl_lim_amount: '0',
  max_cov_amount: '750',
  effective_date: '12/03/2025',
};

/** Fixed "now", so 'active' / 'stale' / 'future' do not drift with the calendar. */
const NOW = new Date('2026-08-20T09:00:00Z');

beforeEach(() => {
  appToken = '';
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok([]));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the DOT clause', () => {
  /**
   * THE PADDING TRAP, and the reason this file exists. On the insurance and BOC-3 datasets
   * `dot_number` is TEXT zero-padded to exactly 8 characters on 100% of rows, so a bare equality
   * matches ZERO rows and returns `[]` with HTTP 200. The cast is the one clause that works on all
   * three datasets, verified live on DOTs 174 / 535 / 10001 / 85526 / 652739 / 4100741 / 4582558.
   */
  it('casts the column instead of comparing a bare or padded string', async () => {
    await fetchCensusByDot('652739');
    await fetchInsuranceByDot('652739', NOW);
    await fetchProcessAgentsByDot('652739');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of [0, 1, 2]) {
      const where = param('$where', call);
      expect(where).toContain('dot_number::number = 652739');
      // Neither spelling of the un-cast comparison may reappear.
      expect(where).not.toContain("dot_number = '652739'");
      expect(where).not.toContain("dot_number = '00652739'");
      // Nor the functions that do not exist in this SoQL dialect (HTTP 400 no-such-function).
      expect(where).not.toMatch(/to_number|ltrim|pad_left/);
    }
  });

  it('accepts the zero-padded form the frozen datasets themselves emit', async () => {
    await fetchInsuranceByDot('00652739', NOW);
    expect(param('$where')).toContain('dot_number::number = 652739');
  });

  /**
   * `dot_number::number = 0` is not an empty answer: it returns 7,855 insurance rows (the `'00000000'`
   * broker sentinel) and 159,140 BOC-3 rows. A half-typed or blank DOT would attach thousands of
   * unrelated carriers' filings to the case under review, so it must never reach the wire.
   */
  it('refuses a DOT that cannot be one, without making a request', async () => {
    for (const bad of ['0', '', '   ', '221', '2231', '00000221', 'MC652739', '652739x', '123456789']) {
      const census = await fetchCensusByDot(bad);
      const insurance = await fetchInsuranceByDot(bad, NOW);
      const agents = await fetchProcessAgentsByDot(bad);
      // Unavailable, NOT a clean empty answer: we could not look, so nothing was cleared.
      expect(census.available, bad).toBe(false);
      expect(insurance.available, bad).toBe(false);
      expect(agents.available, bad).toBe(false);
      expect(census.record, bad).toBeNull();
      expect(insurance.filings, bad).toEqual([]);
      expect(agents.agents, bad).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the query params', () => {
  /** Socrata rejects ANY unknown argument with HTTP 400 "Unrecognized arguments" — no nonce, no tracing. */
  it('sends only $-prefixed arguments', async () => {
    await fetchInsuranceByDot('652739', NOW);
    for (const key of sentUrl().searchParams.keys()) expect(key.startsWith('$')).toBe(true);
  });

  /**
   * THE $ORDER TRAP. `trans_date` is `MM/DD/YYYY` TEXT, so an uncast DESC sort orders by MONTH — a
   * 07/08/1996 filing was returned ahead of one from 05/31/2024. The current-versus-superseded verdict
   * is decided by "first row wins", so a text sort inverts every insurance answer this desk reads.
   */
  it('casts every date it orders by, and never text-compares a date', async () => {
    await fetchInsuranceByDot('652739', NOW);
    expect(param('$order')).toBe(
      'trans_date::floating_timestamp DESC, effective_date::floating_timestamp DESC',
    );
    // No raw text comparison against a date column anywhere in the request.
    const url = decodeURIComponent(sentUrl().search);
    expect(url).not.toMatch(/(trans_date|effective_date|cancl_effective_date)\s*(<|>|<=|>=|=)\s*'/);
    // And no date_trunc on a raw text column, which is an outright HTTP 400.
    expect(url).not.toMatch(/date_trunc_y\((trans_date|effective_date)\)/);
  });

  /** Never read an unordered page: the natural scan order is unstable and leads with the typo rows. */
  it('orders every multi-row page it asks for', async () => {
    await searchCensusByName('swift trans');
    expect(param('$order')).not.toBe('');
    await fetchProcessAgentsByDot('652739');
    expect(param('$order', 1)).not.toBe('');
  });

  /**
   * An EMPTY app token is fine (anonymous access works and is what this deployment uses); a WRONG one
   * is a hard HTTP 403 `permission_denied`. Sending the header empty would break every call.
   */
  it('omits X-App-Token entirely when the token is empty', async () => {
    await fetchCensusByDot('652739');
    expect('X-App-Token' in headers()).toBe(false);
  });

  it('sends X-App-Token only when one is actually configured', async () => {
    appToken = 'live-token';
    await fetchCensusByDot('652739');
    expect(headers()['X-App-Token']).toBe('live-token');
  });
});

describe('the census probe', () => {
  it('parses the live row for DOT 652739', async () => {
    fetchMock.mockResolvedValue(ok([CENSUS_ROW]));
    const out = await fetchCensusByDot('652739');
    expect(out.available).toBe(true);
    expect(out.record).toMatchObject({
      dotNumber: '652739',
      legalName: 'STONE EXPRESS INC',
      statusCode: 'A',
      statusLabel: 'Active',
      carrierOperation: 'A',
      carrierOperationLabel: 'Interstate',
      // Both arrive as JSON STRINGS despite `power_units` being a number column.
      powerUnits: 7,
      totalDrivers: 5,
      phone: '9737672454',
    });
    expect(out.record?.address).toEqual({
      street: '99 DELL GLEN AVE',
      city: 'LODI',
      state: 'NJ',
      zip: '07644',
    });
  });

  /** `add_date` is `YYYYMMDD` text and is the authority-age signal — 1996 here, not "19960731". */
  it('parses the YYYYMMDD add_date into an ISO date', async () => {
    fetchMock.mockResolvedValue(ok([CENSUS_ROW]));
    expect((await fetchCensusByDot('652739')).record?.addDate).toBe('1996-07-31');
  });

  it('assembles dockets from the prefix/number/status triple', async () => {
    fetchMock.mockResolvedValue(ok([CENSUS_ROW]));
    expect((await fetchCensusByDot('652739')).record?.dockets).toEqual([
      { prefix: 'MC', number: '307348', statusCode: 'A', statusLabel: 'Active' },
    ]);
  });

  /**
   * A carrier with NO docket has no MC authority — a finding in its own right, and only 39.8% of census
   * rows carry `docket1`. The absent slots must produce nothing rather than a half-built entry: the
   * columns are OMITTED from the JSON when null, so `docket2prefix` is `undefined`, never `null`.
   */
  it('yields an empty docket array rather than fabricating an entry', async () => {
    const { docket1prefix, docket1, docket1_status_code, ...noDocket } = CENSUS_ROW;
    void docket1prefix;
    void docket1;
    void docket1_status_code;
    fetchMock.mockResolvedValue(ok([noDocket]));
    const out = await fetchCensusByDot('652739');
    expect(out.available).toBe(true);
    expect(out.record?.dockets).toEqual([]);
    // A row missing most of its columns still parses — a strict deserializer would throw here.
    expect(out.record?.dbaName).toBeNull();
    expect(out.record?.safetyRating).toBeNull();
  });

  /** `P` is real (1,124 rows) and undocumented. It must not be given a reassuring made-up meaning. */
  it('labels the undocumented P status without inventing a meaning', async () => {
    fetchMock.mockResolvedValue(ok([{ ...CENSUS_ROW, status_code: 'P' }]));
    const out = await fetchCensusByDot('652739');
    expect(out.record?.statusCode).toBe('P');
    expect(out.record?.statusLabel).toMatch(/undocumented/i);
  });

  it('degrades to UNAVAILABLE rather than to no-such-carrier when the lookup fails', async () => {
    fetchMock.mockResolvedValue(soqlError('query.soql.no-such-column'));
    const out = await fetchCensusByDot('652739');
    expect(out.available).toBe(false);
    expect(out.record).toBeNull();
    expect(out.error).toMatch(/query.soql.no-such-column/);
  });

  it('never throws', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(fetchCensusByDot('652739')).resolves.toBeTruthy();
  });
});

describe('the census name search', () => {
  /**
   * SoQL `like` IS CASE-SENSITIVE and census data is stored uppercase:
   * `legal_name like '%swift trans%'` returns 0 rows, `upper(legal_name) like upper('%swift trans%')`
   * returns 116. Both measured. The lower-case spelling is a search that looks like it ran.
   */
  it('upper()s both sides of a name search', async () => {
    await searchCensusByName('swift trans');
    expect(param('$where')).toBe("upper(legal_name) like upper('%swift trans%')");
  });

  it('doubles a quote in the needle rather than ending the literal', async () => {
    await searchCensusByName("o'brien");
    expect(param('$where')).toBe("upper(legal_name) like upper('%o''brien%')");
  });

  it('refuses a needle too short to be a search, without making a request', async () => {
    const out = await searchCensusByName('sw');
    expect(fetchMock).not.toHaveBeenCalled();
    // Unavailable, not "no carrier by that name".
    expect(out).toMatchObject({ available: false, records: [], truncated: false });
    expect(out.error).toMatch(/at least/);
  });

  it('flags a truncated page so the caller does not read 2 as the whole answer', async () => {
    fetchMock.mockResolvedValue(ok([CENSUS_ROW, CENSUS_ROW]));
    const out = await searchCensusByName('swift trans', 2);
    expect(param('$limit')).toBe('2');
    expect(out.truncated).toBe(true);
  });

  it('degrades to UNAVAILABLE rather than to no-matching-carrier when the lookup fails', async () => {
    fetchMock.mockResolvedValue(soqlError('query.soql.no-such-function'));
    const out = await searchCensusByName('swift trans');
    expect(out.available).toBe(false);
    expect(out.records).toEqual([]);
    expect(out.truncated).toBe(false);
    expect(out.error).toMatch(/no-such-function/);
  });

  it('never throws', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(searchCensusByName('swift trans')).resolves.toBeTruthy();
  });
});

describe('the insurance probe', () => {
  it('reports the freeze in every answer, including the empty one', async () => {
    const out = await fetchInsuranceByDot('652739', NOW);
    expect(out).toMatchObject({ available: true, frozen: true, dataAsOf: '2026-05-14', filings: [] });
    expect(SOCRATA_FROZEN_AS_OF).toBe('2026-05-14');
  });

  it('parses the live BIPD filing, money included', async () => {
    fetchMock.mockResolvedValue(ok([INSURANCE_ROW]));
    const out = await fetchInsuranceByDot('652739', NOW);
    expect(out.filings).toEqual([
      {
        docketNumber: 'MC307348',
        formCode: '91X',
        // From `mod_col_1`, whose DISPLAY name is `ins_type_desc` — selecting that name is an HTTP 400.
        formLabel: 'BIPD/Primary',
        insurer: 'PRIME PROPERTY & CASUALTY INSURANCE INC',
        policyNo: 'PC25120208',
        transDate: '2025-12-15',
        effectiveDate: '2025-12-03',
        // The key is ABSENT from the JSON, not null — and absence is not cancellation.
        canclEffectiveDate: null,
        // MONEY IS IN THOUSANDS: '750' is the $750,000 general-freight minimum, not $750.
        maxCoverageDollars: 750_000,
        underlyingLimitDollars: null,
        status: 'active',
      },
    ]);
  });

  it('reads $1M and $5M filings at the right magnitude', async () => {
    fetchMock.mockResolvedValue(
      ok([
        { ...INSURANCE_ROW, max_cov_amount: '1000' },
        { ...INSURANCE_ROW, docket_number: 'MC307349', max_cov_amount: '5000' },
      ]),
    );
    const out = await fetchInsuranceByDot('652739', NOW);
    expect(out.filings.map((f) => f.maxCoverageDollars)).toEqual([1_000_000, 5_000_000]);
  });

  /**
   * Form 91 is a VALID liability filing and all 5,414 of its rows carry `max_cov_amount` '0' — as do
   * 100% of forms 34, 84, 85, 82 and 83. Reading that as $0 would decline a carrier over a column that
   * never held a figure, so it reports NOT STATED and the caller has to say "unknown".
   */
  it('does not read form 91 zero as "no coverage"', async () => {
    fetchMock.mockResolvedValue(
      ok([{ ...INSURANCE_ROW, ins_form_code: '91', mod_col_1: 'BIPD', max_cov_amount: '0' }]),
    );
    const filing = (await fetchInsuranceByDot('652739', NOW)).filings[0];
    expect(filing?.formCode).toBe('91');
    expect(filing?.maxCoverageDollars).toBeNull();
    expect(filing?.maxCoverageDollars).not.toBe(0);
  });

  /**
   * `cancl_effective_date` is missing from 95.3% of rows — the KEY IS ABSENT, so `row.x === null` is
   * never true. Absence means "never formally cancelled", which is not "cancelled" and not "insured".
   */
  it('parses a row whose cancel key is absent, and does not read it as cancelled', async () => {
    fetchMock.mockResolvedValue(ok([INSURANCE_ROW]));
    const filing = (await fetchInsuranceByDot('652739', NOW)).filings[0];
    expect(filing?.canclEffectiveDate).toBeNull();
    expect(filing?.status).not.toBe('cancelled');
  });

  /**
   * ...AND YET an uncancelled filing is not automatically live. This table retains decades-old
   * uncancelled filings from insurers that no longer exist; DOT 652739 carries a 2005 cargo filing with
   * no cancel date right now. Calling that 'active' is the false clear this whole module exists to
   * avoid, so it reports 'stale' — unknown, go read the certificate.
   */
  it('does not report a 1996 filing with no cancel date as active', async () => {
    fetchMock.mockResolvedValue(
      ok([{ ...INSURANCE_ROW, trans_date: '07/08/1996', effective_date: '06/30/1996' }]),
    );
    const filing = (await fetchInsuranceByDot('652739', NOW)).filings[0];
    expect(filing?.status).toBe('stale');
  });

  /**
   * A cancellation date is always a FUTURE scheduled one when filed — and 17,969 carriers (4.7%) that
   * read as insured at the freeze have since passed theirs. The dataset will never learn; the verdict
   * has to be computed against `now`.
   */
  it('treats a cancellation date that has since passed as cancelled', async () => {
    fetchMock.mockResolvedValue(
      ok([{ ...INSURANCE_ROW, effective_date: '01/10/2026', cancl_effective_date: '06/15/2026' }]),
    );
    expect((await fetchInsuranceByDot('652739', NOW)).filings[0]?.status).toBe('cancelled');
  });

  it('reports a not-yet-effective filing as future, not as coverage', async () => {
    fetchMock.mockResolvedValue(
      ok([{ ...INSURANCE_ROW, trans_date: '08/01/2026', effective_date: '09/15/2026' }]),
    );
    expect((await fetchInsuranceByDot('652739', NOW)).filings[0]?.status).toBe('future');
  });

  /**
   * 46 rows have effective_date == cancl_effective_date and 9 are inverted (55, 0.012%) — source-side
   * YEAR typos, usually corrected by a fresh row on the same policy weeks later. DOT 652739 carries one
   * live: trans 12/02/2025 with effective AND cancel both 12/03/2026. Filtering on `effective <= cancel`
   * drops them; the corrected row survives and keeps the verdict.
   */
  it('drops the typo rows where effective equals or beats cancel', async () => {
    fetchMock.mockResolvedValue(
      ok([
        INSURANCE_ROW,
        {
          ...INSURANCE_ROW,
          trans_date: '12/02/2025',
          effective_date: '12/03/2026',
          cancl_effective_date: '12/03/2026',
        },
        {
          ...INSURANCE_ROW,
          trans_date: '11/02/2025',
          effective_date: '08/10/2032',
          cancl_effective_date: '08/10/2026',
        },
      ]),
    );
    const out = await fetchInsuranceByDot('652739', NOW);
    expect(out.filings).toHaveLength(1);
    expect(out.filings[0]?.status).toBe('active');
  });

  /**
   * Newest per (docket_number, ins_form_code) decides; the rest are history. Grouping on the PAIR
   * because one carrier holds liability, cargo and surety filings at once, across up to 4 dockets — a
   * cargo filing must not supersede a liability one.
   */
  it('keeps the newest filing per docket and form, and marks the rest superseded', async () => {
    fetchMock.mockResolvedValue(
      ok([
        INSURANCE_ROW,
        { ...INSURANCE_ROW, trans_date: '03/04/2024', effective_date: '03/01/2024', policy_no: 'OLD' },
        {
          ...INSURANCE_ROW,
          ins_form_code: '34',
          mod_col_1: 'CARGO',
          max_cov_amount: '0',
          trans_date: '01/09/2025',
          effective_date: '01/05/2025',
        },
      ]),
    );
    const out = await fetchInsuranceByDot('652739', NOW);
    expect(out.filings.map((f: { formCode: string; status: string }) => `${f.formCode}:${f.status}`)).toEqual([
      '91X:active',
      '91X:superseded',
      '34:active',
    ]);
  });

  it('degrades to UNAVAILABLE rather than to an empty filing list when the lookup fails', async () => {
    fetchMock.mockResolvedValue(soqlError('query.soql.type-mismatch'));
    const out = await fetchInsuranceByDot('652739', NOW);
    expect(out.available).toBe(false);
    expect(out.filings).toEqual([]);
    expect(out.error).toMatch(/query.soql.type-mismatch/);
    // The freeze is a property of the dataset, so it is reported even when the read failed.
    expect(out).toMatchObject({ frozen: true, dataAsOf: '2026-05-14' });
  });

  it('never throws', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    await expect(fetchInsuranceByDot('652739', NOW)).resolves.toBeTruthy();
  });
});

describe('the BOC-3 probe', () => {
  const BOC3_ROW = {
    docket_number: 'MC307348',
    dot_number: '00652739',
    co_name: 'PROCESS AGENT SERVICE COMPANY, INC.',
    attn_to_or_title: 'SANDY ROSE',
    street_po: '945 S. MARION RD. STE. 203',
    city: 'SIOUX FALLS',
    state_code: 'SD',
    ctry_code: 'US',
    zip_code: '57106',
  };

  it('parses the agent, and names it as the agent rather than the carrier', async () => {
    fetchMock.mockResolvedValue(ok([BOC3_ROW]));
    const out = await fetchProcessAgentsByDot('652739');
    expect(out.agents).toEqual([
      {
        docketNumber: 'MC307348',
        agentName: 'PROCESS AGENT SERVICE COMPANY, INC.',
        attnTo: 'SANDY ROSE',
        address: {
          street: '945 S. MARION RD. STE. 203',
          city: 'SIOUX FALLS',
          state: 'SD',
          country: 'US',
          zip: '57106',
        },
      },
    ]);
  });

  /**
   * 48,813 carriers registered after the freeze, and every one returns `[]`. That is "we cannot know",
   * NOT "no process agent on file" — the distinction only survives if the freeze rides along with the
   * empty answer, which is exactly the case Phase 4 sees most on new applicants.
   */
  it('reports the freeze alongside an empty agent list', async () => {
    const out = await fetchProcessAgentsByDot('4582558');
    expect(out).toMatchObject({
      available: true,
      error: null,
      frozen: true,
      dataAsOf: '2026-05-14',
      agents: [],
    });
  });

  it('degrades to UNAVAILABLE rather than to no-agent-on-file when the lookup fails', async () => {
    fetchMock.mockResolvedValue(soqlError('query.soql.no-such-column'));
    const out = await fetchProcessAgentsByDot('652739');
    expect(out.available).toBe(false);
    expect(out.agents).toEqual([]);
    expect(out.error).toMatch(/no-such-column/);
    expect(out).toMatchObject({ frozen: true, dataAsOf: '2026-05-14' });
  });

  it('never throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(fetchProcessAgentsByDot('652739')).resolves.toBeTruthy();
  });
});

/**
 * WHAT THE GREEN SUITE WAS HIDING.
 *
 * All four `never throws` tests fed a rejected fetch — already inside the try — and asserted only
 * `resolves.toBeTruthy()`, which any object satisfies. Two real throw sites and one wrong-number bug
 * lived underneath that for the whole build. These are the regressions.
 */
describe('the failure modes a passing suite hid', () => {
  it('does not throw on a name needle that is not well-formed UTF-16', async () => {
    fetchMock.mockResolvedValue(ok([]));
    // A lone high surrogate. `encodeURIComponent` raises URIError on it, and the URL was being built
    // outside the guarded region — so this rejected out of a probe documented as never throwing.
    //
    // It DEGRADES rather than silently stripping the bad byte, and that is the right answer for a
    // search: the needle is the question, so a needle we could not encode is a question we did not
    // ask. `available: false` says so; a stripped needle would quietly search for something else.
    const out = await searchCensusByName('ACME \uD800 CO');
    expect(out).toMatchObject({ available: false, records: [], truncated: false });
    expect(out.error).toBeTruthy();
  });

  it('refuses an unusable as-of date instead of throwing RangeError, and spends no request', async () => {
    // `toISOString()` raises RangeError on an invalid Date, and every filing status is relative to it.
    const out = await fetchInsuranceByDot('652739', new Date('not a date'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ available: false, frozen: true, filings: [] });
    expect(out.error).toMatch(/as-of date/i);
  });

  /**
   * THE WRONG-NUMBER BUG. `91X` is not one thing: `mod_col_1` splits it into BIPD/Primary (386,661
   * rows), BIPD/Excess (5,945) and two BIPD/Full variants. Keying the newest-wins group on
   * (docket, form) alone let a later-filed EXCESS row mark the live PRIMARY filing superseded — and
   * then the surviving row reported the excess limit as the carrier's coverage. Both must be active.
   */
  it('does not let an excess layer supersede the primary liability filing', async () => {
    fetchMock.mockResolvedValue(
      ok([
        {
          ...INSURANCE_ROW,
          mod_col_1: 'BIPD/Excess',
          trans_date: '12/20/2025',
          max_cov_amount: '5000',
        },
        {
          ...INSURANCE_ROW,
          mod_col_1: 'BIPD/Primary',
          trans_date: '08/14/2023',
          max_cov_amount: '1000',
        },
      ]),
    );
    const out = await fetchInsuranceByDot('652739', NOW);
    expect(out.filings.map((f: { formLabel: string | null; status: string }) => [f.formLabel, f.status])).toEqual([
      ['BIPD/Excess', 'active'],
      ['BIPD/Primary', 'active'],
    ]);
  });

  /**
   * `dot_number` is a declared NUMBER column, so `parseCensusRow` rejects a row where it is not a
   * JSON string. A Socrata type change would then flip every lookup to "not in the census" silently —
   * available and empty, which a reviewer reads as a finding about the carrier.
   */
  it('reports a census row it cannot read as UNAVAILABLE, not as an absent carrier', async () => {
    fetchMock.mockResolvedValue(ok([{ ...CENSUS_ROW, dot_number: 652739 }]));
    const out = await fetchCensusByDot('652739');
    expect(out).toMatchObject({ available: false, record: null });
    expect(out.error).toMatch(/could not be read/i);
  });

  it('falls back to the default page size on a non-finite limit rather than sending $limit=NaN', async () => {
    fetchMock.mockResolvedValue(ok([]));
    await searchCensusByName('SWIFT', Number.NaN);
    expect(sentUrl().searchParams.get('$limit')).not.toBe('NaN');
    expect(Number(sentUrl().searchParams.get('$limit'))).toBeGreaterThan(0);
  });

  it('sends only $-prefixed arguments on EVERY probe, not just the insurance one', async () => {
    fetchMock.mockResolvedValue(ok([]));
    await fetchCensusByDot('652739');
    await searchCensusByName('SWIFT');
    await fetchInsuranceByDot('652739', NOW);
    await fetchProcessAgentsByDot('652739');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (let call = 0; call < 4; call += 1) {
      const search = decodeURIComponent(sentUrl(call).search);
      for (const key of sentUrl(call).searchParams.keys()) expect(key.startsWith('$')).toBe(true);
      // Trap 9: the stored form codes carry no `BMC-` prefix, so a filter written that way matches
      // nothing and returns HTTP 200. Trap 3: a date literal must never carry a trailing `Z`.
      expect(search).not.toContain('BMC-');
      expect(search).not.toMatch(/T\d{2}:\d{2}:\d{2}(\.\d+)?Z/);
    }
  });
});

describe('the error-versus-empty distinction', () => {
  /**
   * The whole degradation contract rests on this: `[]` + HTTP 200 is an ANSWER, HTTP 400 is a FAILURE,
   * and `available` tracks that and nothing else. Anything that blurs the two turns "we could not
   * check" into "we checked and it was fine".
   */
  it('reads HTTP 200 with an empty array as available and empty', async () => {
    fetchMock.mockResolvedValue(ok([]));
    expect(await fetchCensusByDot('652739')).toMatchObject({
      available: true,
      error: null,
      record: null,
    });
    expect((await fetchInsuranceByDot('652739', NOW)).available).toBe(true);
    expect((await fetchProcessAgentsByDot('652739')).available).toBe(true);
  });

  it('reads a non-JSON body as a failure rather than as an empty answer', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>502</html>' });
    const out = await fetchCensusByDot('652739');
    expect(out.available).toBe(false);
    expect(out.record).toBeNull();
  });

  /** No 429 exists on this API, so a transport failure IS the throttle signal — reported, never retried. */
  it('makes exactly one request per lookup and does not retry a failure', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    await fetchCensusByDot('652739');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is configured from the base URL alone, never from the optional token', async () => {
    expect(isSocrataConfigured()).toBe(true);
  });
});
