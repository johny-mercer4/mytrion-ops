import { describe, expect, it } from 'vitest';
import {
  allIdentityOk,
  caseMovedPastPhase,
  identityChecksFor,
  identityChecklistLines,
  missingIdentityDocs,
  showPhaseDecideActions,
} from './caseIdentity';

describe('identityChecksFor', () => {
  it('gives owner-operators the individual checklist, not the carrier one', () => {
    const oo = identityChecksFor('owner_operator').map((c) => c.id);
    const carrier = identityChecksFor('carrier').map((c) => c.id);
    expect(oo).toContain('drivers_license');
    expect(oo).toContain('ssn_docs');
    expect(oo).not.toContain('company_ein');
    expect(carrier).toContain('company_ein');
    expect(carrier).toContain('mc_dot');
    expect(carrier).not.toContain('drivers_license');
    expect(identityChecklistLines('owner_operator')).toContain("Driver's licence");
    expect(identityChecklistLines('carrier')).toContain('Legal company name and EIN');
  });
});

describe('allIdentityOk / missingIdentityDocs', () => {
  const checks = identityChecksFor('carrier');

  it('blocks pass until every check is OK', () => {
    expect(allIdentityOk(checks, {})).toBe(false);
    expect(allIdentityOk(checks, { company_ein: 'ok' })).toBe(false);
    const allOk = Object.fromEntries(checks.map((c) => [c.id, 'ok' as const]));
    expect(allIdentityOk(checks, allOk)).toBe(true);
  });

  it('maps missing marks onto the existing document-request items', () => {
    expect(missingIdentityDocs(checks, { bank_ownership: 'missing' })).toEqual([
      { docType: 'bank_statement', label: 'Bank statement' },
    ]);
  });
});

describe('showPhaseDecideActions', () => {
  const open = {
    phaseStatus: 'in_progress',
    applies: true,
    closed: false,
    locked: false,
    movedPast: false,
  };

  it('hides Pass / manager / Decline once the phase is signed off or the case moved on', () => {
    expect(showPhaseDecideActions(open)).toBe(true);
    expect(showPhaseDecideActions({ ...open, phaseStatus: 'passed' })).toBe(false);
    expect(showPhaseDecideActions({ ...open, movedPast: true })).toBe(false);
    expect(showPhaseDecideActions({ ...open, locked: true })).toBe(false);
    expect(showPhaseDecideActions({ ...open, applies: false })).toBe(false);
    expect(showPhaseDecideActions({ ...open, phaseStatus: 'skipped' })).toBe(true);
    expect(caseMovedPastPhase(2, 'p3_screening')).toBe(true);
    expect(caseMovedPastPhase(2, 'p2_identity')).toBe(false);
  });
});
