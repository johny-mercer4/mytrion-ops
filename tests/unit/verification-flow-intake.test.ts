import { describe, expect, it } from 'vitest';
import {
  evaluateIntakeCompleteness,
  missingFieldKeys,
  REQUIRED_BANK_STATEMENTS,
  type IntakeCandidate,
} from '../../src/modules/verificationFlow/intake.js';

const EMPTY: IntakeCandidate = {
  applicantType: null,
  firstName: null,
  lastName: null,
  companyName: null,
  dateOfBirth: null,
  dlLast4: null,
  ssnLast4: null,
  residentialAddress: null,
  businessAddress: null,
  ein: null,
  mc: null,
  dot: null,
  email: null,
  phone: null,
  trucksCount: null,
  fuelCardsRequested: null,
  requestedLimit: null,
  bankingSource: null,
  plaidConnected: false,
};

/** A complete Flow A application. */
const OWNER_OPERATOR: IntakeCandidate = {
  ...EMPTY,
  applicantType: 'owner_operator',
  firstName: 'Marisol',
  lastName: 'Otero',
  dateOfBirth: '1984-03-11',
  dlLast4: '9921',
  ssnLast4: '4821',
  residentialAddress: '18 Cedar Row, Laredo TX',
  email: 'm.otero@example.com',
  phone: '(555) 123-4567',
  trucksCount: 2,
  fuelCardsRequested: 2,
  requestedLimit: '4000.00',
  bankingSource: 'statements',
};

/** A complete Flow B application. */
const CARRIER: IntakeCandidate = {
  ...EMPTY,
  applicantType: 'carrier',
  companyName: 'Kaiser Freight LLC',
  ein: '87-1234567',
  mc: 'MC-884210',
  dot: '3391044',
  businessAddress: '4400 Industrial Pkwy, Columbus OH',
  email: 'ops@kaiserfreight.com',
  phone: '6145550110',
  trucksCount: 14,
  fuelCardsRequested: 12,
  requestedLimit: '38000.00',
  bankingSource: 'statements',
};

const statements = (n: number) =>
  Array.from({ length: n }, () => ({ docType: 'bank_statement' as const, status: 'received' as const }));

const PRINCIPAL = [{ fullName: 'Anders Kaiser' }];

describe('applicant type gates everything', () => {
  it('asks only for the applicant type when it is unset', () => {
    const verdict = evaluateIntakeCompleteness(EMPTY, [], []);
    expect(verdict.complete).toBe(false);
    expect(verdict.missing).toHaveLength(1);
    expect(verdict.missing[0]?.field).toBe('applicantType');
  });
});

describe('Flow A — owner-operator / individual', () => {
  it('is complete with all fields and three statements', () => {
    const verdict = evaluateIntakeCompleteness(OWNER_OPERATOR, [], statements(3));
    expect(verdict.missing).toEqual([]);
    expect(verdict.complete).toBe(true);
  });

  it('does not require company fields', () => {
    const verdict = evaluateIntakeCompleteness(OWNER_OPERATOR, [], statements(3));
    expect(missingFieldKeys(verdict)).not.toContain('ein');
    expect(missingFieldKeys(verdict)).not.toContain('companyName');
  });

  it('does not require principals', () => {
    const verdict = evaluateIntakeCompleteness(OWNER_OPERATOR, [], statements(3));
    expect(missingFieldKeys(verdict)).not.toContain('principals');
  });

  it('requires identity documents by last-4', () => {
    const verdict = evaluateIntakeCompleteness(
      { ...OWNER_OPERATOR, ssnLast4: null, dlLast4: null },
      [],
      statements(3),
    );
    expect(missingFieldKeys(verdict)).toEqual(expect.arrayContaining(['ssnLast4', 'dlLast4']));
  });
});

describe('Flow B — carrier', () => {
  it('is complete with company fields, a principal and three statements', () => {
    const verdict = evaluateIntakeCompleteness(CARRIER, PRINCIPAL, statements(3));
    expect(verdict.missing).toEqual([]);
    expect(verdict.complete).toBe(true);
  });

  it('requires at least one owner / principal', () => {
    const verdict = evaluateIntakeCompleteness(CARRIER, [], statements(3));
    expect(missingFieldKeys(verdict)).toContain('principals');
  });

  it('requires MC and USDOT', () => {
    const verdict = evaluateIntakeCompleteness({ ...CARRIER, mc: null, dot: null }, PRINCIPAL, statements(3));
    expect(missingFieldKeys(verdict)).toEqual(expect.arrayContaining(['mc', 'dot']));
  });

  it('does not require the owner-operator identity fields', () => {
    const verdict = evaluateIntakeCompleteness(CARRIER, PRINCIPAL, statements(3));
    expect(missingFieldKeys(verdict)).not.toContain('ssnLast4');
    expect(missingFieldKeys(verdict)).not.toContain('dateOfBirth');
  });
});

describe('company without MC/DOT', () => {
  it('completes without authority numbers — the absence routes it to Manager Review, it is not missing data', () => {
    const verdict = evaluateIntakeCompleteness(
      { ...CARRIER, applicantType: 'company', mc: null, dot: null },
      PRINCIPAL,
      statements(3),
    );
    expect(verdict.complete).toBe(true);
  });

  it('still requires EIN and business address', () => {
    const verdict = evaluateIntakeCompleteness(
      { ...CARRIER, applicantType: 'company', ein: null, businessAddress: null },
      PRINCIPAL,
      statements(3),
    );
    expect(missingFieldKeys(verdict)).toEqual(expect.arrayContaining(['ein', 'businessAddress']));
  });
});

describe('banking — three statements OR Plaid', () => {
  it(`requires ${REQUIRED_BANK_STATEMENTS} statements`, () => {
    const verdict = evaluateIntakeCompleteness(CARRIER, PRINCIPAL, statements(2));
    expect(missingFieldKeys(verdict)).toContain('bankStatements');
    expect(verdict.missing.find((m) => m.field === 'bankStatements')?.label).toMatch(/2 of 3/);
  });

  it('accepts a Plaid connection instead of statements', () => {
    const verdict = evaluateIntakeCompleteness(
      { ...CARRIER, bankingSource: 'plaid', plaidConnected: true },
      PRINCIPAL,
      [],
    );
    expect(verdict.complete).toBe(true);
  });

  it('does not accept Plaid selected but not connected', () => {
    const verdict = evaluateIntakeCompleteness(
      { ...CARRIER, bankingSource: 'plaid', plaidConnected: false },
      PRINCIPAL,
      [],
    );
    expect(missingFieldKeys(verdict)).toContain('plaidConnected');
  });

  it('counts only received statements — a requested one is the ask, not the answer', () => {
    const docs = [
      ...statements(2),
      { docType: 'bank_statement' as const, status: 'requested' as const },
      { docType: 'bank_statement' as const, status: 'rejected' as const },
    ];
    const verdict = evaluateIntakeCompleteness(CARRIER, PRINCIPAL, docs);
    expect(missingFieldKeys(verdict)).toContain('bankStatements');
  });

  it('does not count other document types toward the statement requirement', () => {
    const docs = [
      ...statements(1),
      { docType: 'insurance' as const, status: 'received' as const },
      { docType: 'ssn_card' as const, status: 'received' as const },
    ];
    const verdict = evaluateIntakeCompleteness(CARRIER, PRINCIPAL, docs);
    expect(missingFieldKeys(verdict)).toContain('bankStatements');
  });
});

describe('request fields', () => {
  it('treats zero fuel cards as missing, not as a valid request', () => {
    const verdict = evaluateIntakeCompleteness({ ...CARRIER, fuelCardsRequested: 0 }, PRINCIPAL, statements(3));
    expect(missingFieldKeys(verdict)).toContain('fuelCardsRequested');
  });

  it('treats zero trucks as missing', () => {
    const verdict = evaluateIntakeCompleteness({ ...CARRIER, trucksCount: 0 }, PRINCIPAL, statements(3));
    expect(missingFieldKeys(verdict)).toContain('trucksCount');
  });

  it('rejects whitespace-only values', () => {
    const verdict = evaluateIntakeCompleteness({ ...CARRIER, email: '   ' }, PRINCIPAL, statements(3));
    expect(missingFieldKeys(verdict)).toContain('email');
  });
});

describe('missing list ordering', () => {
  it('lists the earliest wizard section first so the agent is sent to the right step', () => {
    const verdict = evaluateIntakeCompleteness({ ...EMPTY, applicantType: 'carrier' }, [], []);
    const sections = verdict.missing.map((m) => m.section);
    const firstBanking = sections.indexOf('banking');
    const firstBusiness = sections.indexOf('business');
    expect(firstBusiness).toBeGreaterThanOrEqual(0);
    expect(firstBusiness).toBeLessThan(firstBanking);
  });
});
