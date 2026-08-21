/**
 * "What to check" — the aside used to contradict the pane beside it.
 *
 * Every line was a `readOnly` checkbox bound to `phase.status === 'passed'`, so on Identity and
 * Screening a reviewer could mark six of seven checks OK and still see seven empty boxes, then all
 * seven fill the instant the phase passed. These are the mappings that make the list agree with the
 * marks — including `attention`, which a tick box cannot express at all and which is the state that
 * actually needs the reviewer's eye.
 */
import { describe, expect, it } from 'vitest';
import { checklistIsLive, checklistLines, checklistProgress } from './caseChecklist';
import { identityChecksFor, type IdentityMark } from './caseIdentity';
import {
  blacklistMarkFromRun,
  citifuelSentence,
  duplicateMarkFromRun,
  EMPTY_SCREENING_MARKS,
  SCREENING_CHECKLIST,
  screeningRunFrom,
  type ScreeningMarks,
} from './caseScreening';
import {
  AUTHORITY_CHECKS,
  authorityActiveFromStatus,
  authorityAgeYears,
  authoritySuggestions,
  EMPTY_AUTHORITY_MARKS,
} from './caseAuthority';

const base = {
  labels: ['a', 'b', 'c'] as readonly string[],
  applicantType: 'owner_operator' as const,
  identityMarks: {} as Record<string, IdentityMark>,
  screeningMarks: EMPTY_SCREENING_MARKS as ScreeningMarks,
  authorityMarks: EMPTY_AUTHORITY_MARKS,
};

describe('which phases are live', () => {
  /** The three phases that carry per-check marks. Everything else has only its sign-off to report. */
  it('is Identity, Screening and Authority, and only those', () => {
    for (const code of ['p2_identity', 'p3_screening', 'p4_authority']) {
      expect(checklistIsLive(code), code).toBe(true);
    }
    for (const code of ['p1_intake', 'p5_routing', 'p6_credit_banking', 'p8_highway', 'p10_decision']) {
      expect(checklistIsLive(code), code).toBe(false);
    }
  });
});

describe('a phase with no per-check marks', () => {
  it('follows the phase — every line outstanding until it passes', () => {
    const lines = checklistLines({ ...base, phaseCode: 'p1_intake', phasePassed: false });
    expect(lines.map((l) => l.state)).toEqual(['todo', 'todo', 'todo']);
  });

  it('and every line done once it has', () => {
    const lines = checklistLines({ ...base, phaseCode: 'p1_intake', phasePassed: true });
    expect(lines.map((l) => l.state)).toEqual(['done', 'done', 'done']);
  });

  it('gives each line a stable id, so React is not keying on the label text', () => {
    const lines = checklistLines({ ...base, phaseCode: 'p8_highway', phasePassed: false });
    expect(lines.map((l) => l.id)).toEqual(['p8_highway:0', 'p8_highway:1', 'p8_highway:2']);
  });
});

describe('identity follows the marks', () => {
  const checks = identityChecksFor('owner_operator');
  const lines = (marks: Record<string, IdentityMark>) =>
    checklistLines({ ...base, phaseCode: 'p2_identity', phasePassed: false, identityMarks: marks });

  it('starts with every check outstanding', () => {
    expect(lines({}).every((l) => l.state === 'todo')).toBe(true);
    expect(lines({})).toHaveLength(checks.length);
  });

  it('marks only the check that was set', () => {
    const out = lines({ full_name: 'ok' });
    expect(out.find((l) => l.id === 'full_name')?.state).toBe('done');
    expect(out.filter((l) => l.state === 'todo')).toHaveLength(checks.length - 1);
  });

  /** `missing` and `inconsistent` are both `attention`, and each says WHY — the note is the point. */
  it('turns Missing and Inconsistent into attention, with a reason', () => {
    const out = lines({ ssn_docs: 'missing', consistency: 'inconsistent' });
    const ssn = out.find((l) => l.id === 'ssn_docs')!;
    const consistency = out.find((l) => l.id === 'consistency')!;
    expect(ssn.state).toBe('attention');
    expect(ssn.note).toMatch(/request the document/i);
    expect(consistency.state).toBe('attention');
    expect(consistency.note).toMatch(/inconsistent/i);
  });

  /**
   * SAME COLOUR AS THE PANE. `attention` covers an ASK (Missing — amber) and a FINDING (Inconsistent —
   * red), and the pane paints those differently; one amber tone for both was two panels disagreeing
   * about the same row.
   */
  it('separates an ask from a finding by tone', () => {
    const out = lines({ ssn_docs: 'missing', consistency: 'inconsistent' });
    expect(out.find((l) => l.id === 'ssn_docs')!.tone).toBe('warn');
    expect(out.find((l) => l.id === 'consistency')!.tone).toBe('bad');
    // Nothing recorded and nothing wrong carry no tone at all.
    expect(out.find((l) => l.id === 'full_name')!.tone).toBeUndefined();
    expect(lines({ full_name: 'ok' }).find((l) => l.id === 'full_name')!.tone).toBeUndefined();
  });

  it('uses the CARRIER checks on a carrier case', () => {
    const out = checklistLines({
      ...base,
      applicantType: 'carrier',
      phaseCode: 'p2_identity',
      phasePassed: false,
    });
    expect(out.map((l) => l.id)).toContain('mc_dot');
    expect(out.map((l) => l.id)).not.toContain('drivers_license');
  });

  /**
   * Marks live in component state and are empty on a fresh mount, so a phase already signed off would
   * read as entirely outstanding if the marks won. The recorded decision is the stronger fact.
   */
  it('lets a recorded pass win over empty marks', () => {
    const out = checklistLines({ ...base, phaseCode: 'p2_identity', phasePassed: true });
    expect(out.every((l) => l.state === 'done')).toBe(true);
  });
});

describe('screening follows the marks', () => {
  const lines = (marks: ScreeningMarks) =>
    checklistLines({ ...base, phaseCode: 'p3_screening', phasePassed: false, screeningMarks: marks });

  it('starts with both checks outstanding', () => {
    expect(lines(EMPTY_SCREENING_MARKS).map((l) => l.state)).toEqual(['todo', 'todo']);
    expect(lines(EMPTY_SCREENING_MARKS).map((l) => l.label)).toEqual([...SCREENING_CHECKLIST]);
  });

  it('clears on the yes-path marks', () => {
    expect(lines({ blacklist: 'none', duplicate: 'no' }).map((l) => l.state)).toEqual(['done', 'done']);
  });

  /** A possible hit is the reviewer's to resolve; a confirmed one declines and informs Collections. */
  it('separates a possible hit from a confirmed one in the note and the tone', () => {
    const possible = lines({ blacklist: 'possible', duplicate: null })[0]!;
    const confirmed = lines({ blacklist: 'confirmed', duplicate: null })[0]!;
    expect(possible.note).toMatch(/resolve it/i);
    expect(possible.tone).toBe('warn');
    expect(confirmed.note).toMatch(/Collections/i);
    expect(confirmed.tone).toBe('bad');
  });

  it('flags a duplicate as a finding', () => {
    const out = lines({ blacklist: 'none', duplicate: 'yes' });
    expect(out[1]!.state).toBe('attention');
    expect(out[1]!.tone).toBe('bad');
    expect(out[1]!.note).toMatch(/already a customer/i);
  });
});

describe('the count in the head', () => {
  it('counts done, attention and total over the lines shown', () => {
    const out = checklistLines({
      ...base,
      phaseCode: 'p2_identity',
      phasePassed: false,
      identityMarks: { full_name: 'ok', drivers_license: 'ok', ssn_docs: 'missing' },
    });
    expect(checklistProgress(out)).toEqual({
      done: 2,
      attention: 1,
      total: identityChecksFor('owner_operator').length,
    });
  });

  it('is all zeroes on an empty list rather than throwing', () => {
    expect(checklistProgress([])).toEqual({ done: 0, attention: 0, total: 0 });
  });
});

/**
 * Phase 3's automated run, and the mark it may suggest.
 *
 * The rule that matters is the last one: a run whose ban-list lookup was UNAVAILABLE suggests nothing.
 * Returning "No match" there would record a clear the system never obtained, which is the exact shape
 * of the bug Check A already had — it screened against an empty table and passed every case.
 */
describe('the screening run', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    ranAt: '2026-08-20T09:00:00.000Z',
    identifiersScreened: 7,
    blacklistHits: 0,
    duplicateHits: 0,
    banList: {
      source: 'credit_platform.public.blacklist_entries',
      available: true,
      error: null,
      platformHits: 0,
      ownHits: 0,
    },
    ...over,
  });

  it('reads nothing out of findings that carry no run', () => {
    expect(screeningRunFrom(null)).toBeNull();
    expect(screeningRunFrom({})).toBeNull();
    expect(screeningRunFrom({ identifiersScreened: 7 })).toBeNull();
  });

  it('reads a completed run', () => {
    const out = screeningRunFrom(run())!;
    expect(out.ranAt).toBe('2026-08-20T09:00:00.000Z');
    expect(out.identifiersScreened).toBe(7);
    expect(out.banList?.available).toBe(true);
  });

  it('suggests No match on a clean run', () => {
    expect(blacklistMarkFromRun(screeningRunFrom(run()))).toBe('none');
  });

  /** A hit is `possible`, never `confirmed`: the SOP puts a human between a match and a decline. */
  it('suggests Possible — not Confirmed — when the run found something', () => {
    expect(blacklistMarkFromRun(screeningRunFrom(run({ blacklistHits: 2 })))).toBe('possible');
  });

  it('suggests NOTHING when the ban list could not be read', () => {
    const unavailable = run({
      banList: { source: 'x', available: false, error: 'connection refused', platformHits: 0, ownHits: 0 },
    });
    expect(blacklistMarkFromRun(screeningRunFrom(unavailable))).toBeNull();
  });

  it('suggests nothing at all before a run', () => {
    expect(blacklistMarkFromRun(null)).toBeNull();
  });
});

/**
 * CHECK B'S SUGGESTION, which has three sources and therefore three ways to be unable to answer.
 *
 * The rule is Check A's: a mark of "no duplicate" is a CLEAR, and a clear may only come from sources
 * that actually spoke. An unreachable Zoho, a Citifuel value this desk cannot read, or a run written
 * before the Deal scan existed all leave the question open.
 */
describe('the duplicate suggestion', () => {
  const clean = (over: Record<string, unknown> = {}) => ({
    ranAt: '2026-08-20T09:00:00.000Z',
    identifiersScreened: 7,
    blacklistHits: 0,
    duplicateHits: 0,
    duplicateScan: {
      caseHits: 0,
      dealHits: 0,
      dealsAvailable: true,
      dealsError: null,
      dealsTruncated: false,
    },
    citifuel: { source: 'Deals.citifuel_Status', available: true, status: 'no', verdict: 'clear' },
    ...over,
  });

  it('suggests No duplicate only when every source answered', () => {
    expect(duplicateMarkFromRun(screeningRunFrom(clean()))).toBe('no');
  });

  it('suggests Duplicate on a shared identifier', () => {
    expect(duplicateMarkFromRun(screeningRunFrom(clean({ duplicateHits: 1 })))).toBe('yes');
  });

  /** `yes` and `active` are the two values the exact-string check was letting through. */
  it('suggests Duplicate on a flagged Citifuel status even with no shared identifier', () => {
    const flagged = clean({
      citifuel: { available: true, status: 'yes', verdict: 'flagged' },
    });
    expect(duplicateMarkFromRun(screeningRunFrom(flagged))).toBe('yes');
  });

  it('suggests NOTHING when Zoho Deals were not scanned', () => {
    const noDeals = clean({
      duplicateScan: { caseHits: 0, dealHits: 0, dealsAvailable: false, dealsError: 'COQL 500', dealsTruncated: false },
    });
    expect(duplicateMarkFromRun(screeningRunFrom(noDeals))).toBeNull();
  });

  it('suggests NOTHING when the Deal scan hit its row cap', () => {
    const capped = clean({
      duplicateScan: { caseHits: 0, dealHits: 0, dealsAvailable: true, dealsError: null, dealsTruncated: true },
    });
    expect(duplicateMarkFromRun(screeningRunFrom(capped))).toBeNull();
  });

  it('suggests NOTHING on a Citifuel value it cannot read as yes or no', () => {
    const unknown = clean({
      citifuel: { available: true, status: 'App Filled', verdict: 'unknown' },
    });
    expect(duplicateMarkFromRun(screeningRunFrom(unknown))).toBeNull();
  });

  /** A run from before the Deal scan shipped consulted neither Zoho nor Citifuel. */
  it('suggests NOTHING for a run that predates the Deal scan', () => {
    const legacy = clean({ duplicateScan: undefined, citifuel: undefined });
    delete (legacy as Record<string, unknown>).duplicateScan;
    delete (legacy as Record<string, unknown>).citifuel;
    expect(duplicateMarkFromRun(screeningRunFrom(legacy))).toBeNull();
  });

  it('never treats a missing Citifuel block as available', () => {
    expect(screeningRunFrom(clean({ citifuel: undefined }))?.citifuel).toBeNull();
  });
});

describe('the Citifuel sentence', () => {
  it('names the raw value on a flagged status, so the reviewer sees what Zoho said', () => {
    const out = citifuelSentence({ available: true, status: 'Lead Converted', verdict: 'flagged' });
    expect(out.tone).toBe('bad');
    expect(out.text).toContain('Lead Converted');
  });

  it('reads an unknown value as a question, not as a clear', () => {
    const out = citifuelSentence({ available: true, status: 'App Filled', verdict: 'unknown' });
    expect(out.tone).toBe('warn');
    expect(out.text).toMatch(/cannot read/i);
  });

  it('says the status could not be read when the source was unavailable', () => {
    const out = citifuelSentence({ available: false, status: null, verdict: 'absent' });
    expect(out.tone).toBe('warn');
    expect(out.text).toMatch(/not a clear/i);
  });

  it('distinguishes an explicit no from an absent status', () => {
    expect(citifuelSentence({ available: true, status: 'no', verdict: 'clear' }).tone).toBe('good');
    expect(citifuelSentence({ available: true, status: null, verdict: 'absent' }).tone).toBe('neutral');
  });
});

/**
 * Phase 4's suggestions come from `stg_broker_snapshot` — FMCSA-SHAPED warehouse data, not a live FMCSA
 * call. What it does NOT answer is as important as what it does: MC status, insurance and operating
 * history are absent from the warehouse, and filling them with a guess would put a name against a check
 * nobody performed.
 */
describe('authority suggestions from the warehouse snapshot', () => {
  const NOW = Date.parse('2026-08-20T00:00:00.000Z');

  it('suggests nothing without a snapshot', () => {
    expect(authoritySuggestions(null, NOW)).toEqual({});
  });

  it('reads an authorised carrier as active', () => {
    const out = authoritySuggestions(
      { dotNumber: '987654', operatingStatus: 'AUTHORIZED FOR PROPERTY', authorityAddedOn: '2019-03-01' },
      NOW,
    );
    expect(out.dot?.mark).toBe('ok');
    expect(out.operating?.mark).toBe('ok');
    expect(out.dot?.because).toMatch(/AUTHORIZED FOR PROPERTY/);
    expect(out.authority_age?.because).toMatch(/about 7 years ago/);
  });

  it('reads an out-of-service carrier as inactive', () => {
    const out = authoritySuggestions(
      { dotNumber: '1', operatingStatus: 'OUT OF SERVICE', authorityAddedOn: null },
      NOW,
    );
    expect(out.dot?.mark).toBe('inactive');
    expect(out.operating?.mark).toBe('inactive');
  });

  /** A status we do not recognise implies nothing — the reviewer reads it themselves. */
  it('suggests nothing for a status it cannot classify', () => {
    const out = authoritySuggestions(
      { dotNumber: '1', operatingStatus: 'SOMETHING NEW', authorityAddedOn: null },
      NOW,
    );
    expect(out.dot).toBeUndefined();
    expect(out.operating).toBeUndefined();
  });

  it('never suggests MC, insurance or operating history', () => {
    const out = authoritySuggestions(
      { dotNumber: '1', operatingStatus: 'AUTHORIZED FOR PROPERTY', authorityAddedOn: '2019-03-01' },
      NOW,
    );
    expect(out.mc).toBeUndefined();
    expect(out.insurance).toBeUndefined();
    expect(out.history).toBeUndefined();
  });

  it('ignores an authority date in the future rather than reporting a negative age', () => {
    expect(authorityAgeYears('2030-01-01', NOW)).toBeNull();
    expect(authorityAgeYears(null, NOW)).toBeNull();
    expect(authorityActiveFromStatus('')).toBeNull();
  });
});

/**
 * Phase 4's checklist is live too, now that it carries real marks. The `na` case is the one worth
 * pinning: "does not apply to this applicant" is an ANSWER, so it counts as done — otherwise a clean
 * carrier reads as two checks short for ever.
 */
describe('authority follows the marks', () => {
  const lines = (marks: typeof EMPTY_AUTHORITY_MARKS) =>
    checklistLines({
      ...base,
      applicantType: 'carrier',
      phaseCode: 'p4_authority',
      phasePassed: false,
      authorityMarks: marks,
    });

  it('is a live phase', () => {
    expect(checklistIsLive('p4_authority')).toBe(true);
  });

  it('lists every check plus the two structure questions', () => {
    expect(lines(EMPTY_AUTHORITY_MARKS)).toHaveLength(AUTHORITY_CHECKS.length + 2);
    expect(lines(EMPTY_AUTHORITY_MARKS).every((l) => l.state === 'todo')).toBe(true);
  });

  it('separates an inactive authority from a missing document by tone', () => {
    const out = lines({ ...EMPTY_AUTHORITY_MARKS, checks: { dot: 'inactive', insurance: 'missing' } });
    expect(out.find((l) => l.id === 'dot')).toMatchObject({ state: 'attention', tone: 'bad' });
    expect(out.find((l) => l.id === 'insurance')).toMatchObject({ state: 'attention', tone: 'warn' });
  });

  it('counts N/A on a structure question as answered', () => {
    const out = lines({ ...EMPTY_AUTHORITY_MARKS, relatedCompany: 'na', thirdParty: 'needed' });
    expect(out.find((l) => l.id === 'related_company')?.state).toBe('done');
    expect(out.find((l) => l.id === 'third_party')).toMatchObject({ state: 'attention', tone: 'warn' });
  });
});
