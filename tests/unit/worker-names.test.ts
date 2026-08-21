/**
 * Which name a colleague sees.
 *
 * The four rows below are real: two directories in this database disagree about the same people,
 * and the collection Owner column has to pick one. It picks the CRM name, because these screens
 * replace CRM screens and renaming half the team on the day they switch would read as a bug.
 * If that ever changes it should change here, deliberately, not by a join being reordered.
 */
import { describe, expect, it } from 'vitest';
import { mergeWorkerNames } from '../../src/repos/workerNameRepo.js';

const HR = [
  { zohoUserId: '6227679000038542039', firstName: 'Farrux', lastName: 'Jabborov' },
  { zohoUserId: '6227679000093960901', firstName: 'Asadbek', lastName: 'Xojimatov' },
  { zohoUserId: '6227679000144698013', firstName: 'Abbos', lastName: 'Abduroziqov' },
  { zohoUserId: '6227679000999999999', firstName: 'Only', lastName: 'InHr' },
];

const KPI = [
  { zohoUserId: '6227679000038542039', displayName: 'Felix Johnson' },
  { zohoUserId: '6227679000093960901', displayName: 'John Mercer' },
  { zohoUserId: '6227679000144698013', displayName: 'Abbos Abduroziqov' },
  { zohoUserId: '6227679000888888888', displayName: 'Only In KPI' },
];

describe('mergeWorkerNames', () => {
  it('shows the CRM name where the two directories disagree', () => {
    const names = mergeWorkerNames(HR, KPI);
    expect(names.get('6227679000038542039')).toBe('Felix Johnson');
    expect(names.get('6227679000093960901')).toBe('John Mercer');
  });

  it('agrees with itself where the directories agree', () => {
    expect(mergeWorkerNames(HR, KPI).get('6227679000144698013')).toBe('Abbos Abduroziqov');
  });

  it('falls back to HR for anyone the CRM sync has not seen', () => {
    expect(mergeWorkerNames(HR, KPI).get('6227679000999999999')).toBe('Only InHr');
  });

  it('takes a CRM-only worker too', () => {
    expect(mergeWorkerNames(HR, KPI).get('6227679000888888888')).toBe('Only In KPI');
  });

  it('leaves an unknown id absent rather than guessing — the caller picks the fallback', () => {
    expect(mergeWorkerNames(HR, KPI).has('6227679000000000000')).toBe(false);
  });

  it('ignores blank names in either directory instead of showing an empty cell', () => {
    const names = mergeWorkerNames(
      [{ zohoUserId: 'u1', firstName: '  ', lastName: null }],
      [{ zohoUserId: 'u1', displayName: '   ' }],
    );
    expect(names.has('u1')).toBe(false);
  });

  it('builds a full name from whichever HR part is present', () => {
    const names = mergeWorkerNames([{ zohoUserId: 'u2', firstName: 'Mononym', lastName: null }], []);
    expect(names.get('u2')).toBe('Mononym');
  });
});
