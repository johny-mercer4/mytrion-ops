/**
 * Phase 4's authority lookup — who it runs for, which keys it spends a call on, and what it records.
 *
 * WHAT THIS PINS, and why each one is load-bearing:
 *
 *  - CARRIER ONLY. `p4_authority` does not apply to an owner-operator, and `buildRail` still renders a
 *    phase's `findings` when `applies` is false — so writing a blob for a non-carrier would put an
 *    FMCSA panel underneath the words "Not applicable".
 *  - A FAILED SOURCE IS NOT A CLEAR. Off-Render every FMCSA host denies our egress at the edge, so the
 *    `available: false` path is the everyday one, and its flags have to reach the findings for the pane
 *    to say "not read" instead of rendering an absence.
 *  - IT MUST NOT WITHDRAW A DECISION. `upsertPhase` nulls outcome/decidedAt/decidedBy unconditionally;
 *    `recordPhaseObservation` is the writer that cannot. Using the wrong one silently un-passes a phase.
 *  - JUNK KEYS COST A CALL AND RETURN A CONFIDENT WRONG ANSWER. Our own cases carry `221` and `2231` in
 *    the USDOT column.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupFmcsaCarrier = vi.fn();
const fetchFmcsaAuthority = vi.fn();
const fetchCensusByDot = vi.fn();
const fetchInsuranceByDot = vi.fn();
const recordPhaseObservation = vi.fn();
const upsertPhase = vi.fn();

vi.mock('../../src/integrations/fmcsaQcMobile.js', () => ({
  isFmcsaConfigured: () => true,
  lookupFmcsaCarrier: (...args: unknown[]) => lookupFmcsaCarrier(...args),
  fetchFmcsaAuthority: (...args: unknown[]) => fetchFmcsaAuthority(...args),
}));
vi.mock('../../src/integrations/socrataFmcsa.js', () => ({
  fetchCensusByDot: (...args: unknown[]) => fetchCensusByDot(...args),
}));
vi.mock('../../src/integrations/socrataFmcsaFilings.js', () => ({
  SOCRATA_BIPD_FORM_CODE: '91X',
  fetchInsuranceByDot: (...args: unknown[]) => fetchInsuranceByDot(...args),
}));
vi.mock('../../src/repos/verificationCaseAssetRepo.js', () => ({
  verificationCaseAssetRepo: { recordPhaseObservation, upsertPhase },
}));

const { runAuthorityLookup, authorityKeysFor } = await import(
  '../../src/modules/verificationFlow/deskAuthority.js'
);

const CTX = { tenantId: 't1', userId: 'zoho:credit-1' } as never;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'vc_1',
    applicantType: 'carrier',
    dot: '158121',
    mc: '778211',
    carrierDot: null,
    companyName: 'Kaiser Freight LLC',
    ...over,
  } as never;
}

const clean = { available: true, error: null, reason: null } as const;

beforeEach(() => {
  for (const m of [
    lookupFmcsaCarrier,
    fetchFmcsaAuthority,
    fetchCensusByDot,
    fetchInsuranceByDot,
    recordPhaseObservation,
    upsertPhase,
  ]) {
    m.mockReset();
  }
  lookupFmcsaCarrier.mockResolvedValue({
    ...clean,
    notFound: false,
    matchedOn: 'dot',
    carrier: { legalName: 'KAISER FREIGHT LLC' },
    candidates: [],
    candidatesTruncated: false,
    retrievalDate: null,
  });
  fetchFmcsaAuthority.mockResolvedValue({ ...clean, records: [] });
  fetchCensusByDot.mockResolvedValue({ available: true, error: null, record: null });
  fetchInsuranceByDot.mockResolvedValue({
    available: true,
    error: null,
    frozen: true,
    dataAsOf: '2026-05-14',
    filings: [],
  });
});

describe('who it runs for', () => {
  it('refuses an owner-operator rather than writing findings under "Not applicable"', async () => {
    await expect(runAuthorityLookup(CTX, row({ applicantType: 'owner_operator' }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERIFICATION_PHASE_NOT_APPLICABLE',
    });
    expect(recordPhaseObservation).not.toHaveBeenCalled();
    expect(lookupFmcsaCarrier).not.toHaveBeenCalled();
  });

  /** 23 of our 52 cases have a NULL applicant_type, and every one of them has no authority number. */
  it('refuses a case whose applicant type was never set', async () => {
    await expect(runAuthorityLookup(CTX, row({ applicantType: null }))).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe('which keys it spends a call on', () => {
  it('sends digits only, and treats matching MC and USDOT as one key', () => {
    const keys = authorityKeysFor(row({ dot: 'DOT 158121', mc: 'MC-158121' }) as never);
    expect(keys).toMatchObject({ dot: '158121', mc: '158121', authorityNumbersIdentical: true });
  });

  /**
   * FIVE DIGITS IS THE FLOOR. `2231` is owner-operator junk in the USDOT box (carrierEnrich gates at
   * four, which lets it through); `53467` is a real five-digit carrier in our own captured fixtures.
   */
  it('drops a sub-five-digit authority number but keeps a real five-digit one', () => {
    expect(authorityKeysFor(row({ dot: '2231', mc: '221' }) as never)).toMatchObject({
      dot: null,
      mc: null,
    });
    expect(authorityKeysFor(row({ dot: '53467' }) as never).dot).toBe('53467');
  });

  it('falls back to the warehouse USDOT for the census when the application has none', async () => {
    await runAuthorityLookup(CTX, row({ dot: null, mc: null, carrierDot: '4451031' }));
    expect(fetchCensusByDot).toHaveBeenCalledWith('4451031');
    const [, , input] = recordPhaseObservation.mock.calls[0]!;
    expect(input.findings.keys.censusDotFrom).toBe('carrier_dot');
  });

  /**
   * Socrata answers `[]` with HTTP 200 for an unknown DOT, so asking with no DOT at all would record
   * "nothing on file" about a carrier we never looked up.
   */
  it('does not query Socrata at all when there is no usable USDOT', async () => {
    await runAuthorityLookup(CTX, row({ dot: null, mc: null, carrierDot: null }));
    expect(fetchCensusByDot).not.toHaveBeenCalled();
    expect(fetchInsuranceByDot).not.toHaveBeenCalled();
    const [, , input] = recordPhaseObservation.mock.calls[0]!;
    expect(input.findings.census.available).toBe(false);
    expect(input.findings.insurance.available).toBe(false);
  });
});

describe('what it records', () => {
  it('writes through the observation writer, never the one that can withdraw a decision', async () => {
    await runAuthorityLookup(CTX, row());
    expect(recordPhaseObservation).toHaveBeenCalledTimes(1);
    // `upsertPhase` writes outcome/decidedAt/decidedBy as `?? null`, so a re-run through it would
    // silently un-pass an already-decided Phase 4.
    expect(upsertPhase).not.toHaveBeenCalled();
    const [, caseId, input] = recordPhaseObservation.mock.calls[0]!;
    expect(caseId).toBe('vc_1');
    expect(input).toMatchObject({ phaseCode: 'p4_authority', status: 'in_progress' });
  });

  /** THE ONE THAT MATTERS: an edge deny must be visibly a non-read, not an absence of findings. */
  it('records a blocked register as unavailable with its reason, and still keeps the other sources', async () => {
    lookupFmcsaCarrier.mockResolvedValue({
      available: false,
      error: 'HTTP 403 — this egress IP is denied at the FMCSA edge',
      reason: 'blocked',
      notFound: false,
      matchedOn: null,
      carrier: null,
      candidates: [],
      candidatesTruncated: false,
      retrievalDate: null,
    });
    fetchCensusByDot.mockResolvedValue({
      available: true,
      error: null,
      record: { statusCode: 'A', powerUnits: 12 },
    });

    await runAuthorityLookup(CTX, row());
    const [, , input] = recordPhaseObservation.mock.calls[0]!;
    expect(input.findings.register).toMatchObject({ available: false, reason: 'blocked' });
    expect(input.findings.register.error).toMatch(/denied at the FMCSA edge/);
    // One dead source must not cost the other three.
    expect(input.findings.census).toMatchObject({ available: true, frozen: false });
  });

  it('marks the insurance feed frozen with its cutoff, and the census live', async () => {
    await runAuthorityLookup(CTX, row());
    const [, , input] = recordPhaseObservation.mock.calls[0]!;
    expect(input.findings.insurance).toMatchObject({ frozen: true, dataAsOf: '2026-05-14' });
    expect(input.findings.census.frozen).toBe(false);
  });

  /** `91X` is the liability form, and the stored codes carry no `BMC-` prefix. */
  it('counts only ACTIVE BIPD filings, and takes coverage from the newest', async () => {
    fetchInsuranceByDot.mockResolvedValue({
      available: true,
      error: null,
      frozen: true,
      dataAsOf: '2026-05-14',
      filings: [
        { formCode: '91X', status: 'active', maxCoverageDollars: 1_000_000 },
        { formCode: '91X', status: 'cancelled', maxCoverageDollars: 750_000 },
        { formCode: '34', status: 'active', maxCoverageDollars: 5_000 },
      ],
    });
    await runAuthorityLookup(CTX, row());
    const [, , input] = recordPhaseObservation.mock.calls[0]!;
    expect(input.findings.insurance.bipdActive).toBe(1);
    expect(input.findings.insurance.bipdCoverageDollars).toBe(1_000_000);
  });

  it('flags an application USDOT that disagrees with the warehouse one', async () => {
    await runAuthorityLookup(CTX, row({ dot: '158121', carrierDot: '4451031' }));
    const [, , input] = recordPhaseObservation.mock.calls[0]!;
    expect(input.findings.keys.carrierDotDisagrees).toBe(true);
  });
});
