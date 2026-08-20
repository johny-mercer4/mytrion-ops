import { describe, expect, it } from 'vitest';
import type { VerificationPrincipal } from '@/api/verificationFlow';
import {
  screeningCanPass,
  screeningDeclineOutcome,
  screeningIdentityFacts,
} from './caseScreening';

const principals: VerificationPrincipal[] = [
  {
    id: 'p1',
    fullName: 'Pat Ridge',
    role: 'owner',
    ownershipPct: null,
    dateOfBirth: null,
    ssnLast4: null,
    phone: null,
    email: null,
    address: null,
  },
];

describe('screeningIdentityFacts', () => {
  it('shows owner-operator name and SSN, not company EIN', () => {
    const facts = screeningIdentityFacts(
      {
        applicantType: 'owner_operator',
        firstName: 'Ada',
        lastName: 'Cole',
        ssnLast4: '7788',
        ein: '12-3456789',
        phone: '6145550100',
        email: 'ada@example.com',
        residentialAddress: '1 Oak St',
        businessAddress: '9 Depot Rd',
        mc: '111',
        dot: '222',
      },
      [],
    );
    const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
    expect(byId.name).toMatchObject({ label: 'Name', value: 'Ada Cole' });
    expect(byId.tax).toMatchObject({ label: 'SSN last 4', value: '7788' });
    expect(byId.address).toMatchObject({ label: 'Residential address', value: '1 Oak St' });
    expect(facts.map((f) => f.id)).toEqual(['name', 'tax', 'phone', 'email', 'address', 'ip', 'mc', 'dot']);
  });

  it('shows carrier company, EIN, principals and business address', () => {
    const facts = screeningIdentityFacts(
      {
        applicantType: 'carrier',
        companyName: 'Ridgevale Freight',
        firstName: 'Ada',
        lastName: 'Cole',
        ssnLast4: '7788',
        ein: '12-3456789',
        businessAddress: '9 Depot Rd',
        residentialAddress: '1 Oak St',
        mc: '123456',
        dot: '987654',
        phone: null,
        email: null,
      },
      principals,
    );
    const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
    expect(byId.name?.value).toContain('Ridgevale Freight');
    expect(byId.name?.value).toContain('Pat Ridge');
    expect(byId.tax).toMatchObject({ label: 'EIN', value: '12-3456789' });
    expect(byId.address).toMatchObject({ label: 'Business address', value: '9 Depot Rd' });
  });
});

describe('screening gates', () => {
  it('allows pass only when blacklist is clear and there is no duplicate', () => {
    expect(screeningCanPass({ blacklist: null, duplicate: null })).toBe(false);
    expect(screeningCanPass({ blacklist: 'possible', duplicate: 'no' })).toBe(false);
    expect(screeningCanPass({ blacklist: 'confirmed', duplicate: 'no' })).toBe(false);
    expect(screeningCanPass({ blacklist: 'none', duplicate: 'yes' })).toBe(false);
    expect(screeningCanPass({ blacklist: 'none', duplicate: 'no' })).toBe(true);
  });

  it('routes a confirmed blacklist through the existing decline_blacklist door', () => {
    expect(screeningDeclineOutcome({ blacklist: 'confirmed', duplicate: 'no' })).toBe('decline_blacklist');
    expect(screeningDeclineOutcome({ blacklist: 'none', duplicate: 'no' })).toBe('decline');
  });
});
