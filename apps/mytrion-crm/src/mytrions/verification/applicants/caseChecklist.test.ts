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
import { EMPTY_SCREENING_MARKS, SCREENING_CHECKLIST, type ScreeningMarks } from './caseScreening';

const base = {
  labels: ['a', 'b', 'c'] as readonly string[],
  applicantType: 'owner_operator' as const,
  identityMarks: {} as Record<string, IdentityMark>,
  screeningMarks: EMPTY_SCREENING_MARKS as ScreeningMarks,
};

describe('which phases are live', () => {
  it('is Identity and Screening, and only those', () => {
    expect(checklistIsLive('p2_identity')).toBe(true);
    expect(checklistIsLive('p3_screening')).toBe(true);
    for (const code of ['p1_intake', 'p4_authority', 'p5_routing', 'p6_credit_banking', 'p8_highway']) {
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
