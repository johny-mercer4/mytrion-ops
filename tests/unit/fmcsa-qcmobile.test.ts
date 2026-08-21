/**
 * FMCSA QCMobile — Verification Phase 4's authority, operating-status and INSURANCE read.
 *
 * WHY THIS SUITE CARRIES THE MEASUREMENTS. QCMobile is unreachable from the machine this client was
 * written on: every path under `mobile.fmcsa.dot.gov` answers HTTP 403 with a 118-byte HTML body
 * from an AWS-ELB edge keyed on our egress IP (Tashkent, UZ) — byte-identical with a valid `webKey`
 * and with no key at all, so it is not authentication, while usa.gov / api.data.gov / irs.gov all
 * answer 200 from the same machine, so it is not our network. It resolves from the US Render
 * instance. So the client could not be developed against the live API, and these tests ARE the
 * contract: every fixture below is a REAL captured body, and every assertion pins a measured fact
 * that a plausible-looking "simplification" would put back as a bug.
 *
 * THE FIVE THAT WOULD SILENTLY MIS-REPORT A CARRIER, each with its own describe block below:
 *  1. `content` has THREE shapes — object, array, and a BARE STRING on every error. A client typing
 *     it `object | array` crashes on the error path, which is the path we are on constantly.
 *  2. A bad or unknown `webKey` returns HTTP **404** with `{"content":"Webkey not found"}`, not 401.
 *     Mapping 404 to "no such carrier" files an auth failure as "this carrier is not in the federal
 *     register" — about a carrier that may be perfectly authorised.
 *  3. HTTP 200 does not imply JSON: a maintenance window serves an HTML page with status 200.
 *  4. `bipdInsuranceOnFile` and friends are DOLLAR AMOUNTS IN THOUSANDS AS STRINGS, not Y/N. `"0"`
 *     is a truthy string, so a boolean reading makes EVERY CARRIER LOOK INSURED.
 *  5. `bipdInsuranceRequired` and friends use a lowercase `u` for unknown beside `Y`/`N`.
 *
 * And two that would waste a screening run: a 403 is a permanent edge deny, never a throttle, so it
 * must not be retried and must not fall through to the next lookup key; and our own USDOT column
 * holds `221` / `2231`, which must never be sent as a lookup key at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Shaped like a real webKey (32 hex) so a leak assertion has something realistic to look for. */
const WEB_KEY = 'b7f3c1d9a4e24f0c8b6d5e2f1a3c4b59';
const BASE_URL = 'https://mobile.fmcsa.dot.gov/qc/services';

const warn = vi.fn();
vi.mock('../../src/lib/logger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/lib/logger.js')>();
  const stub = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
  return { ...mod, logger: stub as unknown as typeof mod.logger };
});

/**
 * The vitest baseline pins `FMCSA_API_KEY` and `FMCSA_BASE_URL` to '' on purpose, so a suite that
 * forgot to stub `fetch` cannot reach FMCSA for real. Both have to be present here or every call
 * short-circuits to `not_configured` — which is correct production behaviour and useless as a
 * fixture. Spread from the real module so `OUTBOUND_HTTP_TIMEOUT_MS` (read by `fetchWithTimeout`)
 * and everything else survives.
 */
vi.mock('../../src/config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/config/env.js')>();
  return { ...mod, env: { ...mod.env, FMCSA_API_KEY: WEB_KEY, FMCSA_BASE_URL: BASE_URL } };
});

const { env } = await import('../../src/config/env.js');
const { lookupFmcsaCarrier, fetchFmcsaAuthority, isFmcsaConfigured } = await import(
  '../../src/integrations/fmcsaQcMobile.js'
);

// --- REAL CAPTURED BODIES. Verbatim, single-line, exactly as the API served them.

/** GET /carriers/158121 — `content` is an OBJECT. */
const CARRIER_BODY = `{"content":{"_links":{"basics":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/basics"},"cargo carried":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/cargo-carried"},"operation classification":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/operation-classification"},"docket numbers":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/docket-numbers"},"carrier active-For-hire authority":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/authority"},"self":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121"}},"carrier":{"allowedToOperate":"Y","bipdInsuranceOnFile":"1000","bipdInsuranceRequired":"Y","bipdRequiredAmount":"750","bondInsuranceOnFile":"0","bondInsuranceRequired":"u","brokerAuthorityStatus":"N","cargoInsuranceOnFile":"0","cargoInsuranceRequired":"u","carrierOperation":{"carrierOperationCode":"A","carrierOperationDesc":"Interstate"},"censusTypeId":{"censusType":"C","censusTypeDesc":"CARRIER","censusTypeId":1},"commonAuthorityStatus":"A","contractAuthorityStatus":"A","crashTotal":15,"dbaName":null,"dotNumber":158121,"driverInsp":259,"driverOosInsp":3,"driverOosRate":1.15830115830115830115830115830115830116,"driverOosRateNationalAverage":"5.51","ein":391474414,"fatalCrash":0,"hazmatInsp":10,"hazmatOosInsp":1,"hazmatOosRate":10,"hazmatOosRateNationalAverage":"4.5","injCrash":3,"isPassengerCarrier":"N","issScore":null,"legalName":"VERIHA TRUCKING INC","mcs150Outdated":"N","oosDate":null,"oosRateNationalAverageYear":"2009-2010","phyCity":"MARINETTE","phyCountry":"US","phyState":"WI","phyStreet":"2830 CLEVELAND AVE","phyZipcode":"54143","reviewDate":"1996-04-22","reviewType":"C","safetyRating":"S","safetyRatingDate":"1996-04-25","safetyReviewDate":"1996-04-22","safetyReviewType":"C","snapshotDate":null,"statusCode":"A","totalDrivers":213,"totalPowerUnits":213,"towawayCrash":12,"vehicleInsp":124,"vehicleOosInsp":17,"vehicleOosRate":13.70967741935483870967741935483870967742,"vehicleOosRateNationalAverage":"20.72"}},"retrievalDate":"2021-02-28T06:33:31.490+0000"}`;
/** GET /carriers/name/VERIHA — `content` is an ARRAY of 2 (AMERICAN ELM SAWMILL, VERIHA TRUCKING). */
const MULTI_BODY = `{"content":[{"_links":{"basics":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/753076/basics"},"cargo carried":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/753076/cargo-carried"},"operation classification":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/753076/operation-classification"},"docket numbers":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/753076/docket-numbers"},"carrier active-For-hire authority":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/753076/authority"}},"carrier":{"allowedToOperate":"Y","bipdInsuranceOnFile":"0","bipdInsuranceRequired":"Y","bipdRequiredAmount":"750","bondInsuranceOnFile":"0","bondInsuranceRequired":"u","brokerAuthorityStatus":"N","cargoInsuranceOnFile":"0","cargoInsuranceRequired":"u","carrierOperation":{"carrierOperationCode":"C","carrierOperationDesc":"Intrastate Non-Hazmat"},"censusTypeId":{"censusType":"C","censusTypeDesc":"CARRIER","censusTypeId":1},"commonAuthorityStatus":"N","contractAuthorityStatus":"N","crashTotal":0,"dbaName":"LEE VERIHA TRUCKING AND EXCAVATING","dotNumber":753076,"driverInsp":0,"driverOosInsp":0,"driverOosRate":0,"driverOosRateNationalAverage":"5.51","ein":391821630,"fatalCrash":0,"hazmatInsp":0,"hazmatOosInsp":0,"hazmatOosRate":0,"hazmatOosRateNationalAverage":"4.5","injCrash":0,"isPassengerCarrier":null,"issScore":null,"legalName":"AMERICAN ELM SAWMILL INC","mcs150Outdated":"N","oosDate":null,"oosRateNationalAverageYear":"2009-2010","phyCity":"PORTERFIELD","phyCountry":"US","phyState":"WI","phyStreet":"W 3065 VERIHA RD","phyZipcode":"54159","reviewDate":null,"reviewType":null,"safetyRating":null,"safetyRatingDate":null,"safetyReviewDate":null,"safetyReviewType":null,"snapshotDate":null,"statusCode":"A","totalDrivers":2,"totalPowerUnits":2,"towawayCrash":0,"vehicleInsp":0,"vehicleOosInsp":0,"vehicleOosRate":0,"vehicleOosRateNationalAverage":"20.72"}},{"_links":{"basics":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/basics"},"cargo carried":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/cargo-carried"},"operation classification":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/operation-classification"},"docket numbers":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/docket-numbers"},"carrier active-For-hire authority":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/158121/authority"}},"carrier":{"allowedToOperate":"Y","bipdInsuranceOnFile":"1000","bipdInsuranceRequired":"Y","bipdRequiredAmount":"750","bondInsuranceOnFile":"0","bondInsuranceRequired":"u","brokerAuthorityStatus":"N","cargoInsuranceOnFile":"0","cargoInsuranceRequired":"u","carrierOperation":{"carrierOperationCode":"A","carrierOperationDesc":"Interstate"},"censusTypeId":{"censusType":"C","censusTypeDesc":"CARRIER","censusTypeId":1},"commonAuthorityStatus":"A","contractAuthorityStatus":"A","crashTotal":15,"dbaName":null,"dotNumber":158121,"driverInsp":259,"driverOosInsp":3,"driverOosRate":1.15830115830115830115830115830115830116,"driverOosRateNationalAverage":"5.51","ein":391474414,"fatalCrash":0,"hazmatInsp":10,"hazmatOosInsp":1,"hazmatOosRate":10,"hazmatOosRateNationalAverage":"4.5","injCrash":3,"isPassengerCarrier":null,"issScore":null,"legalName":"VERIHA TRUCKING INC","mcs150Outdated":"N","oosDate":null,"oosRateNationalAverageYear":"2009-2010","phyCity":"MARINETTE","phyCountry":"US","phyState":"WI","phyStreet":"2830 CLEVELAND AVE","phyZipcode":"54143","reviewDate":"1996-04-22","reviewType":"C","safetyRating":"S","safetyRatingDate":"1996-04-25","safetyReviewDate":"1996-04-22","safetyReviewType":"C","snapshotDate":null,"statusCode":"A","totalDrivers":213,"totalPowerUnits":213,"towawayCrash":12,"vehicleInsp":124,"vehicleOosInsp":17,"vehicleOosRate":13.70967741935483870967741935483870967742,"vehicleOosRateNationalAverage":"20.72"}}],"retrievalDate":"2021-02-28T07:25:05.638+0000"}`;
/** Any request with a bad webKey — `content` is a BARE STRING, and the status is 404. */
const WEBKEY_ERROR_BODY = `{"content":"Webkey not found","retrievalDate":"2021-02-28T07:35:25.991+0000","_links":{"self":{"href":"https://mobile.fmcsa.dot.gov/qc"},"searchByName":{"href":"https://mobile.fmcsa.dot.gov/qc/name/:name"},"lookupBydotNumber":{"href":"https://mobile.fmcsa.dot.gov/qc/id/:dotNumber"}}}`;
/** GET /carriers/53467/authority — one `carrierAuthority` record. */
const AUTHORITY_BODY = `{"content":[{"carrierAuthority":{"applicantID":8960,"authority":"N","authorizedForBroker":"Y","authorizedForHouseholdGoods":"N","authorizedForPassenger":"N","authorizedForProperty":"Y","brokerAuthorityStatus":"A","commonAuthorityStatus":"A","contractAuthorityStatus":"A","docketNumber":138328,"dotNumber":53467,"prefix":"MC"},"_links":{"self":{"href":"https://mobile.fmcsa.dot.gov/qc/services/carriers/53467/authority/8960"}}}],"retrievalDate":"2021-03-02T04:31:25.740+0000"}`;
/** GET /carriers/44110/docket-numbers — kept because it proves `prefix` + `docketNumber` shapes. */

/** The maintenance page, which arrives with status **200**. */
const MAINTENANCE_HTML =
  '<html><head><title>FMCSA System Maintenance Page</title></head><body>Back soon.</body></html>';
/** The edge deny: 118 bytes of HTML from the load balancer, on every path, with or without a key. */
const ELB_DENY_HTML = '<html><head><title>403 Forbidden</title></head><body><h1>403 ERROR</h1></body></html>';

const fetchMock = vi.fn();

const reply = (body: string, status = 200, contentType = 'application/json'): Response =>
  new Response(body, { status, headers: { 'content-type': contentType } });

/** An envelope around whatever `content` a test needs, with a real-shaped retrievalDate. */
const envelope = (content: unknown): string =>
  JSON.stringify({ content, retrievalDate: '2026-08-20T04:12:19.117+0000' });

/** The `{ _links, carrier }` wrapper out of the captured single-carrier body. */
const carrierEntry = (): Record<string, unknown> =>
  JSON.parse(CARRIER_BODY).content as Record<string, unknown>;

/** The same entry with some carrier elements overridden — for the insurance and status variants. */
const carrierEntryWith = (over: Record<string, unknown>): Record<string, unknown> => {
  const entry = carrierEntry();
  return { ...entry, carrier: { ...(entry.carrier as Record<string, unknown>), ...over } };
};

const url = (call = 0): URL => fetchMock.mock.calls[call]![0] as URL;
const init = (call = 0): RequestInit => fetchMock.mock.calls[call]![1] as RequestInit;

beforeEach(() => {
  fetchMock.mockReset();
  warn.mockReset();
  env.FMCSA_API_KEY = WEB_KEY;
  env.FMCSA_BASE_URL = BASE_URL;
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request it makes', () => {
  it('sends the key as the webKey QUERY PARAM and no auth header at all', async () => {
    fetchMock.mockResolvedValue(reply(CARRIER_BODY));
    await lookupFmcsaCarrier({ dot: '158121' });

    expect(url().pathname).toBe('/qc/services/carriers/158121');
    expect(url().searchParams.get('webKey')).toBe(WEB_KEY);
    // QCMobile has no header auth; sending one invites a 400. `Accept` and nothing else.
    expect(init().headers).toEqual({ Accept: 'application/json' });
  });

  it('pages the name search and url-encodes the name', async () => {
    fetchMock.mockResolvedValue(reply(MULTI_BODY));
    await lookupFmcsaCarrier({ name: "O'Brien Hauling & Sons" });

    expect(url().pathname).toBe("/qc/services/carriers/name/O'Brien%20Hauling%20%26%20Sons");
    expect(url().searchParams.get('start')).toBe('1');
    expect(url().searchParams.get('size')).toBe('50');
  });

  it('reports not_configured WITHOUT a round trip when the key is missing', async () => {
    env.FMCSA_API_KEY = '';
    const out = await lookupFmcsaCarrier({ dot: '158121' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ available: false, reason: 'not_configured', notFound: false });
    expect(isFmcsaConfigured()).toBe(false);
  });
});

/**
 * TRAP 1. `content` is an object for `/carriers/{dot}`, an array for either search, and a bare
 * string on every error. All three arrive under the same key, in the same envelope.
 */
describe('the three shapes of content', () => {
  it('parses OBJECT-shaped content, and records that the USDOT produced the hit', async () => {
    fetchMock.mockResolvedValue(reply(CARRIER_BODY));
    const out = await lookupFmcsaCarrier({ dot: '158121' });

    expect(out.available).toBe(true);
    expect(out.matchedOn).toBe('dot');
    expect(out.notFound).toBe(false);
    expect(out.carrier).toMatchObject({
      dotNumber: '158121',
      legalName: 'VERIHA TRUCKING INC',
      // Served as the number 391474414 — a string here so nothing can format it as a number.
      ein: '391474414',
      statusCode: 'A',
      status: 'active',
      allowedToOperate: 'yes',
      // `phyZipcode`, NOT `phyZip`: the docs and the npm SDK say `phyZip`; the bodies say otherwise.
      phyZipcode: '54143',
      phyState: 'WI',
      carrierOperationDesc: 'Interstate',
    });
    expect(out.carrier?.authority.common).toEqual({ raw: 'A', verdict: 'active' });
    expect(out.carrier?.authority.broker).toEqual({ raw: 'N', verdict: 'none' });
    expect(out.retrievalDate).toBe('2021-02-28T06:33:31.490+0000');
  });

  it('leaves an absent element ABSENT rather than inventing a value for it', async () => {
    fetchMock.mockResolvedValue(reply(CARRIER_BODY));
    const { carrier } = await lookupFmcsaCarrier({ dot: '158121' });

    // Null in the captured body ("Elements only appear if they have value"), so not a property here.
    expect(carrier).not.toHaveProperty('dbaName');
    expect(carrier).not.toHaveProperty('oosDate');
    // And the fields the docs promise but the API never sends are not declared at all.
    for (const absent of ['operatingStatus', 'telephone', 'mcNumber', 'outOfService', 'phyZip']) {
      expect(carrier).not.toHaveProperty(absent);
    }
  });

  it('parses ARRAY-shaped content from the docket-number lookup', async () => {
    const entry = JSON.parse(MULTI_BODY).content[1] as unknown;
    fetchMock.mockResolvedValue(reply(envelope([entry])));
    const out = await lookupFmcsaCarrier({ mc: 'MC-778211' });

    expect(url().pathname).toBe('/qc/services/carriers/docket-number/778211');
    expect(out.matchedOn).toBe('mc');
    expect(out.carrier?.legalName).toBe('VERIHA TRUCKING INC');
  });

  /** A string body is an ERROR, whatever the status is. It must never be read as a carrier. */
  it('treats STRING-shaped content as an error, never as a carrier', async () => {
    fetchMock.mockResolvedValue(reply(envelope('Internal Server Error')));
    const out = await lookupFmcsaCarrier({ dot: '158121' });

    expect(out.available).toBe(false);
    expect(out.reason).toBe('http');
    expect(out.carrier).toBeNull();
    expect(out.notFound).toBe(false);
    expect(out.error).toContain('Internal Server Error');
  });
});

/**
 * TRAP 2, and the one that would put a false statement about a real carrier on the record: a bad or
 * unknown webKey answers **404** with `{"content":"Webkey not found"}`. "Webkey not found" also
 * matches /not found/, so the webKey test has to run BEFORE the not-found test.
 */
describe('a rejected webKey versus a carrier that does not exist', () => {
  it('reports the "Webkey not found" 404 as an AUTH failure, not as a missing carrier', async () => {
    fetchMock.mockResolvedValue(reply(WEBKEY_ERROR_BODY, 404));
    const out = await lookupFmcsaCarrier({ dot: '158121' });

    expect(out.reason).toBe('auth');
    expect(out.available).toBe(false);
    // THE POINT: not a statement that this carrier is absent from the federal register.
    expect(out.notFound).toBe(false);
    expect(out.carrier).toBeNull();
  });

  it('reports a genuine 404 as a clean not-found — available, and NOT an unavailable read', async () => {
    fetchMock.mockResolvedValue(reply(envelope('Carrier not found'), 404));
    const out = await lookupFmcsaCarrier({ dot: '48644490' });

    expect(out.available).toBe(true);
    expect(out.notFound).toBe(true);
    expect(out.error).toBeNull();
    expect(out.reason).toBeNull();
    expect(out.carrier).toBeNull();
  });

  it('never lets the webKey reach a returned error or a log line', async () => {
    // undici quotes the request URL in some transport errors, and the key rides in the query string.
    const leaky = `request to ${BASE_URL}/carriers/158121?webKey=${WEB_KEY} failed, reason: ETIMEDOUT`;
    fetchMock.mockRejectedValue(new Error(leaky));
    const out = await lookupFmcsaCarrier({ dot: '158121' });

    expect(out.reason).toBe('transport');
    expect(out.error).not.toContain(WEB_KEY);
    expect(out.error).toContain('***');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(WEB_KEY);
  });
});

/**
 * The edge deny. It is keyed on our egress IP and is identical with and without a key, so it is
 * permanent: there is nothing to back off from, and the next lookup key would be denied identically.
 */
describe('the 403 edge deny', () => {
  it('reports reason blocked, and makes NO second attempt down the ladder', async () => {
    fetchMock.mockResolvedValue(reply(ELB_DENY_HTML, 403, 'text/html'));
    const out = await lookupFmcsaCarrier({ dot: '158121', mc: '778211', name: 'VERIHA TRUCKING' });

    // One call for the USDOT and then nothing: no retry, and no fall-through to MC or name.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.reason).toBe('blocked');
    expect(out.available).toBe(false);
    expect(out.notFound).toBe(false);
    expect(out.error).toMatch(/not retried/);
  });

  it('does not read the deny body looking for a reason to try again', async () => {
    fetchMock.mockResolvedValue(reply(ELB_DENY_HTML, 403, 'text/html'));
    await fetchFmcsaAuthority('158121');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/** TRAP 3. Status 200, `content-type: text/html`, and a body that is not JSON. */
describe('a maintenance window', () => {
  it('reports reason maintenance instead of throwing a parse error', async () => {
    fetchMock.mockResolvedValue(reply(MAINTENANCE_HTML, 200, 'text/html'));
    const out = await lookupFmcsaCarrier({ dot: '158121' });

    expect(out.reason).toBe('maintenance');
    expect(out.available).toBe(false);
    expect(out.notFound).toBe(false);
  });

  it('never throws on it', async () => {
    fetchMock.mockResolvedValue(reply(MAINTENANCE_HTML, 200, 'text/html'));
    await expect(lookupFmcsaCarrier({ dot: '158121' })).resolves.toBeTruthy();
  });

  it('separates a non-JSON body that is NOT the maintenance page', async () => {
    fetchMock.mockResolvedValue(reply('<html><body>nginx</body></html>', 200, 'text/html'));
    expect((await lookupFmcsaCarrier({ dot: '158121' })).reason).toBe('http');
  });
});

/**
 * TRAPS 4 and 5. The insurance elements are dollar amounts in THOUSANDS, as strings, and the
 * "required" elements carry a lowercase `u`. The captured body is itself the proof: BIPD is on file
 * for `"1000"` while bond and cargo are `"0"`, and both of those are `required: 'u'`.
 */
describe('insurance, which is not a boolean', () => {
  it('multiplies by 1000 into dollars, and reads "0" as NOT insured', async () => {
    fetchMock.mockResolvedValue(reply(CARRIER_BODY));
    const { carrier } = await lookupFmcsaCarrier({ dot: '158121' });

    expect(carrier?.insurance.bipd).toEqual({
      raw: '1000',
      dollars: 1_000_000,
      onFile: true,
      required: 'yes',
      // `bipdRequiredAmount: "750"` — thousands as well, so $750,000 of required coverage.
      requiredDollars: 750_000,
    });
    // "0" is a non-empty string. Anything that treats it as a boolean reports this carrier as
    // holding cargo insurance it does not have.
    expect(carrier?.insurance.cargo).toEqual({
      raw: '0',
      dollars: 0,
      onFile: false,
      required: 'unknown',
      requiredDollars: null,
    });
    expect(carrier?.insurance.bond.onFile).toBe(false);
  });

  it('does not break on the lowercase u, and does not turn it into yes or no', async () => {
    fetchMock.mockResolvedValue(reply(CARRIER_BODY));
    const { carrier } = await lookupFmcsaCarrier({ dot: '158121' });
    expect(carrier?.insurance.bond.required).toBe('unknown');
    expect(carrier?.insurance.cargo.required).toBe('unknown');
  });

  it('reports an ABSENT insurance element as null dollars, never as zero', async () => {
    const entry = carrierEntryWith({ bipdInsuranceOnFile: undefined, bipdRequiredAmount: undefined });
    fetchMock.mockResolvedValue(reply(envelope(entry)));
    const { carrier } = await lookupFmcsaCarrier({ dot: '158121' });

    // "we were not told" is not "there is none": null, not 0.
    expect(carrier?.insurance.bipd.dollars).toBeNull();
    expect(carrier?.insurance.bipd.raw).toBeNull();
    expect(carrier?.insurance.bipd.onFile).toBe(false);
  });
});

/**
 * The status and authority codes. `A` is observed; `I` is inferred from MCMIS; an `O` value is
 * claimed in places we could find no citation for. Unrecognised codes must ask a human rather than
 * resolve to something convenient.
 */
describe('status and authority codes', () => {
  it('maps the observed codes and sends everything else to unknown', async () => {
    for (const [statusCode, status] of [['A', 'active'], ['I', 'inactive'], ['O', 'unknown'], ['', 'unknown']]) {
      fetchMock.mockResolvedValue(reply(envelope(carrierEntryWith({ statusCode }))));
      const { carrier } = await lookupFmcsaCarrier({ dot: '158121' });
      expect(carrier?.status).toBe(status);
      // The raw code survives either way, so 'unknown' never loses what the register actually said.
      if (statusCode !== '') expect(carrier?.statusCode).toBe(statusCode);
    }
  });

  it('keeps an unobserved authority code as raw with an unknown verdict, not as inactive', async () => {
    fetchMock.mockResolvedValue(reply(envelope(carrierEntryWith({ commonAuthorityStatus: 'I' }))));
    const { carrier } = await lookupFmcsaCarrier({ dot: '158121' });
    expect(carrier?.authority.common).toEqual({ raw: 'I', verdict: 'unknown' });
  });

  it('reads a missing operate flag as unknown rather than as permission to operate', async () => {
    fetchMock.mockResolvedValue(reply(envelope(carrierEntryWith({ allowedToOperate: undefined }))));
    const { carrier } = await lookupFmcsaCarrier({ dot: '158121' });
    expect(carrier?.allowedToOperate).toBe('unknown');
  });
});

/**
 * The lookup-key gate. Measured over our own 52 verification cases: the USDOT column holds `221` and
 * `2231` (owner-operator junk in the wrong box). `carrierEnrich.ts` gates at >= 4 digits, which lets
 * `2231` through to a query; FIVE is the floor here, and the boundary is asserted both ways below so
 * it cannot drift. Five is not a compromise — the FMCSA census carries 50,410 real five-digit USDOTs,
 * so a six-digit floor would refuse tens of thousands of genuine carriers (including two of the three
 * in our own captured fixtures) to exclude junk that four digits already excludes.
 */
describe('what it will and will not treat as a lookup key', () => {
  it('refuses 221 and 2231 without making a request', async () => {
    for (const dot of ['221', '2231', '0', '00000000', 'No assigned number']) {
      const out = await lookupFmcsaCarrier({ dot });
      expect(fetchMock).not.toHaveBeenCalled();
      // Unanswerable is NOT a clean answer: `available: false` so no caller can read it as a clear,
      // and `reason: null` because the read never left the process.
      expect(out).toMatchObject({ available: false, reason: null, notFound: false, carrier: null });
      expect(out.error).toMatch(/no usable USDOT, MC or carrier name/);
    }
  });

  it('strips the formatting off a USDOT before deciding anything about it', async () => {
    fetchMock.mockResolvedValue(reply(CARRIER_BODY));
    await lookupFmcsaCarrier({ dot: 'DOT 158121' });
    expect(url().pathname).toBe('/qc/services/carriers/158121');
  });

  /**
   * WHY THE FLOOR IS FIVE AND NOT SIX. `53467` (the `/authority` capture) and `44110` (the
   * `/docket-numbers` capture) are real live USDOTs with five digits, so the six-digit floor this
   * client was specified with would have refused to look up two of the three carriers in our own
   * captured fixtures. Five still drops every junk value our 52 cases contain.
   */
  it('accepts the five-digit USDOTs that our own captured fixtures are built from', async () => {
    // `mockImplementation`, not `mockResolvedValue`: one Response cannot be read twice, so reusing it
    // made the second iteration fail into `unavailable('transport')` while the assertion below still
    // passed. The `available` check is what makes that impossible to miss again.
    fetchMock.mockImplementation(() => Promise.resolve(reply(CARRIER_BODY)));
    for (const dot of ['53467', '44110']) {
      fetchMock.mockClear();
      const out = await lookupFmcsaCarrier({ dot });
      expect(url().pathname).toBe(`/qc/services/carriers/${dot}`);
      expect(out).toMatchObject({ available: true, matchedOn: 'dot' });
    }
  });

  /** The other side of the boundary: five digits goes to the register, four never does. */
  it('pins the floor at five digits in both directions', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(CARRIER_BODY)));
    await lookupFmcsaCarrier({ dot: '22310' });
    expect(url().pathname).toBe('/qc/services/carriers/22310');

    fetchMock.mockClear();
    const out = await lookupFmcsaCarrier({ dot: '2231' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.available).toBe(false);
  });

  it('refuses a junk USDOT but still uses the name it was given', async () => {
    fetchMock.mockResolvedValue(reply(MULTI_BODY));
    const out = await lookupFmcsaCarrier({ dot: '2231', name: 'VERIHA' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url().pathname).toBe('/qc/services/carriers/name/VERIHA');
    expect(out.candidates).toHaveLength(2);
  });
});

/**
 * The MC retry. Measured: 10 of our 15 cases with both columns filled carry the SAME number in both,
 * so retrying by MC would ask the register the same question down a different path.
 */
describe('the USDOT then MC then name ladder', () => {
  it('retries by MC when the USDOT is genuinely not in the register', async () => {
    const entry = JSON.parse(MULTI_BODY).content[1] as unknown;
    fetchMock
      .mockResolvedValueOnce(reply(envelope('Carrier not found'), 404))
      .mockResolvedValueOnce(reply(envelope([entry])));
    const out = await lookupFmcsaCarrier({ dot: '158121', mc: '778211' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(url(1).pathname).toBe('/qc/services/carriers/docket-number/778211');
    expect(out.matchedOn).toBe('mc');
  });

  it('does NOT retry when the MC digits are the same number as the USDOT', async () => {
    fetchMock.mockResolvedValue(reply(envelope('Carrier not found'), 404));
    const out = await lookupFmcsaCarrier({ dot: '158121', mc: 'MC-158121' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.notFound).toBe(true);
    expect(out.available).toBe(true);
  });

  it('does not fall through to MC when the USDOT read was UNAVAILABLE rather than not-found', async () => {
    fetchMock.mockResolvedValue(reply(WEBKEY_ERROR_BODY, 404));
    const out = await lookupFmcsaCarrier({ dot: '158121', mc: '778211' });

    // A rejected webKey fails identically on the MC path; a second call buys nothing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.reason).toBe('auth');
  });

  it('never auto-picks from a name search, and marks a full page as truncated', async () => {
    const entry = JSON.parse(MULTI_BODY).content[0] as unknown;
    fetchMock.mockResolvedValue(reply(envelope(Array.from({ length: 50 }, () => entry))));
    const out = await lookupFmcsaCarrier({ name: 'VERIHA' });

    expect(out.carrier).toBeNull();
    expect(out.matchedOn).toBeNull();
    expect(out.candidates).toHaveLength(50);
    // 50 is the silent cap and there is no total-count element, so this is a floor, not the answer.
    expect(out.candidatesTruncated).toBe(true);
    expect(out.notFound).toBe(false);
  });

  it('reports a name search with no matches as a clean not-found', async () => {
    fetchMock.mockResolvedValue(reply(envelope([])));
    const out = await lookupFmcsaCarrier({ name: 'NO SUCH CARRIER LLC' });

    expect(out).toMatchObject({ available: true, notFound: true, candidatesTruncated: false });
    expect(out.candidates).toEqual([]);
  });

  it('returns a multi-carrier docket answer as candidates rather than guessing', async () => {
    fetchMock.mockResolvedValue(reply(MULTI_BODY));
    const out = await lookupFmcsaCarrier({ mc: '778211' });

    expect(out.carrier).toBeNull();
    expect(out.candidates.map((c) => c.legalName)).toEqual([
      'AMERICAN ELM SAWMILL INC',
      'VERIHA TRUCKING INC',
    ]);
  });

  /** THE ONE THAT MATTERS, and the rule the two Phase-3 probes already follow. */
  it('degrades to UNAVAILABLE rather than to no-such-carrier when the lookup fails', async () => {
    fetchMock.mockResolvedValue(reply('{"boom":true}', 500, 'application/json'));
    const out = await lookupFmcsaCarrier({ dot: '158121' });

    expect(out.available).toBe(false);
    expect(out.reason).toBe('http');
    expect(out.notFound).toBe(false);
    expect(out.carrier).toBeNull();
    expect(out.candidates).toEqual([]);
    expect(out.error).toMatch(/500/);
  });

  it('never throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(lookupFmcsaCarrier({ dot: '158121' })).resolves.toBeTruthy();
    fetchMock.mockResolvedValue(reply('not json at all', 200, 'text/plain'));
    await expect(lookupFmcsaCarrier({ name: 'VERIHA' })).resolves.toBeTruthy();
    fetchMock.mockResolvedValue(reply(envelope(null)));
    await expect(lookupFmcsaCarrier({ dot: '158121' })).resolves.toBeTruthy();
  });
});

describe('the authority probe', () => {
  it('parses a carrierAuthority record, including the codes that disagree with each other', async () => {
    fetchMock.mockResolvedValue(reply(AUTHORITY_BODY));
    const out = await fetchFmcsaAuthority('53467');

    expect(url().pathname).toBe('/qc/services/carriers/53467/authority');
    expect(out.available).toBe(true);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toMatchObject({
      // `applicantID` on the wire — the one element here that breaks camelCase.
      applicantId: 8960,
      dotNumber: '53467',
      docketNumber: '138328',
      prefix: 'MC',
      // `authority: "N"` sits beside three "A" codes, so no verdict is derived from it.
      authority: 'N',
      authorizedForProperty: 'yes',
      authorizedForPassenger: 'no',
      authorizedForHouseholdGoods: 'no',
      authorizedForBroker: 'yes',
    });
    expect(out.records[0]?.common).toEqual({ raw: 'A', verdict: 'active' });
    expect(out.records[0]?.broker).toEqual({ raw: 'A', verdict: 'active' });
  });

  /** No authority record IS the answer Phase 4 wants: this carrier holds no operating authority. */
  it('reports a clean not-found as available with no records', async () => {
    fetchMock.mockResolvedValue(reply(envelope('Carrier not found'), 404));
    const out = await fetchFmcsaAuthority('158121');

    expect(out).toEqual({ available: true, error: null, reason: null, records: [] });
  });

  it('refuses an unusable USDOT instead of reporting that the carrier holds no authority', async () => {
    const out = await fetchFmcsaAuthority('2231');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.available).toBe(false);
    expect(out.reason).toBeNull();
    expect(out.records).toEqual([]);
  });

  it('degrades to UNAVAILABLE rather than to no-authority-records when the lookup fails', async () => {
    fetchMock.mockResolvedValue(reply(WEBKEY_ERROR_BODY, 404));
    const out = await fetchFmcsaAuthority('158121');

    expect(out.available).toBe(false);
    expect(out.reason).toBe('auth');
    expect(out.records).toEqual([]);
    expect(out.error).toMatch(/webKey/);
  });

  it('never throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(fetchFmcsaAuthority('158121')).resolves.toBeTruthy();
    fetchMock.mockResolvedValue(reply(MAINTENANCE_HTML, 200, 'text/html'));
    await expect(fetchFmcsaAuthority('158121')).resolves.toBeTruthy();
  });
});

/**
 * WHAT THE GREEN SUITE WAS HIDING.
 *
 * Every one of these three failed silently before the fix, and the whole suite stayed green — the
 * `never throws` test only fed a rejected fetch, which is already inside the try, and the truncation
 * test only fed well-formed entries. These are the regressions, written against the wire.
 */
describe('the failure modes a passing suite hid', () => {
  it('does not throw on a name that is not well-formed UTF-16', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(envelope([]))));
    // A lone high surrogate. `encodeURIComponent` raises URIError on it, and the call site sat
    // outside every try — so this rejected out of a function documented as never throwing.
    await expect(lookupFmcsaCarrier({ name: 'ACME \uD800 TRUCKING' })).resolves.toMatchObject({
      available: true,
    });
  });

  /**
   * THE CONFLATION THIS MODULE EXISTS TO PREVENT. The register answered with three carriers; the
   * wrapper key is mis-cased so none parses. "We could not read the answer" must never come back as
   * "this carrier is not in the register" — a Phase 4 reviewer would record the second as a finding.
   */
  it('reports entries it cannot read as UNAVAILABLE, never as a clean not-found', async () => {
    const unreadable = [{ Carrier: { legalName: 'A' } }, { Carrier: { legalName: 'B' } }];
    fetchMock.mockImplementation(() => Promise.resolve(reply(envelope(unreadable))));
    const out = await lookupFmcsaCarrier({ name: 'ACME' });
    expect(out).toMatchObject({ available: false, reason: 'http', notFound: false });
    expect(out.error).toMatch(/no carrier element/i);
  });

  it('counts truncation on the wire, so one unreadable entry cannot hide a full page', async () => {
    const good = JSON.parse(MULTI_BODY).content[0] as unknown;
    const page = [...Array.from({ length: 49 }, () => good), { notACarrier: true }];
    fetchMock.mockImplementation(() => Promise.resolve(reply(envelope(page))));
    const out = await lookupFmcsaCarrier({ name: 'VERIHA' });
    expect(out.candidates).toHaveLength(49);
    // 50 came back. Reporting the page as complete would hide every match past it.
    expect(out.candidatesTruncated).toBe(true);
  });
});

describe('configuration', () => {
  it('reports availability from the env', () => {
    expect(isFmcsaConfigured()).toBe(true);
    env.FMCSA_API_KEY = '   ';
    expect(isFmcsaConfigured()).toBe(false);
  });
});
