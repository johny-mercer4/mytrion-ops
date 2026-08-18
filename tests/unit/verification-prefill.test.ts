/**
 * Prefill suggestions — what may be offered, and what must never be.
 *
 * The warehouse matches about a QUARTER of live cases, so this is a suggestion source and the
 * tests are mostly about restraint: never over a value the agent already has, never an address
 * into the wrong field, never a second principal.
 */
import { describe, expect, it } from 'vitest';
import { normalisePhone } from '../../src/integrations/dwhBrokerSnapshot.js';
import { suggestionsFor, type PrefillCandidate } from '../../src/modules/verificationFlow/prefill.js';
import type { BrokerSnapshotMatch } from '../../src/integrations/dwhBrokerSnapshot.js';

const MATCH: BrokerSnapshotMatch = {
  matchedOn: 'phone',
  dotNumber: '3757749',
  ownerFullName: 'MARIA OKONKWO',
  physicalAddress: '1200 W LOOP S, HOUSTON, TX 77027',
  phoneNumber: '(614) 555-0110',
  email: 'ops@bluehaul.test',
  powerUnits: 4,
  truckSize: 6,
  operatingStatus: 'ACTIVE',
  authorityAddedOn: '2021-03-04',
};

const EMPTY: PrefillCandidate = {
  applicantType: 'carrier',
  dot: null,
  phone: null,
  email: null,
  businessAddress: null,
  residentialAddress: null,
  trucksCount: null,
  principalCount: 0,
};

const fields = (c: PrefillCandidate, m: BrokerSnapshotMatch = MATCH): string[] =>
  suggestionsFor(c, m).map((s) => s.field);

describe('what the warehouse may fill', () => {
  it('offers every empty field it has a value for', () => {
    expect(fields(EMPTY)).toEqual([
      'dot',
      'phone',
      'email',
      'businessAddress',
      'trucksCount',
      'principalName',
    ]);
  });

  it('never offers over a value the agent already has', () => {
    const filled: PrefillCandidate = {
      ...EMPTY,
      dot: '9999999',
      phone: '2165550000',
      email: 'real@carrier.test',
      businessAddress: '9 Real St',
      trucksCount: 12,
      principalCount: 1,
    };
    expect(fields(filled)).toEqual([]);
  });

  it('treats a sentinel DOT as absent, so the real number is still offered', () => {
    // The same rule the Zoho boundary applies — "0" and non-numeric text are not authorities.
    for (const sentinel of ['0', 'none', 'N/A', '  ']) {
      expect(fields({ ...EMPTY, dot: sentinel }), sentinel).toContain('dot');
    }
  });

  it('offers nothing at all when the warehouse row is empty', () => {
    const bare: BrokerSnapshotMatch = {
      matchedOn: 'dot',
      dotNumber: null,
      ownerFullName: null,
      physicalAddress: null,
      phoneNumber: null,
      email: null,
      powerUnits: null,
      truckSize: null,
      operatingStatus: null,
      authorityAddedOn: null,
    };
    expect(fields(EMPTY, bare)).toEqual([]);
  });
});

describe('the address goes to the field the flow actually has', () => {
  it('is the BUSINESS address for a company', () => {
    expect(fields({ ...EMPTY, applicantType: 'carrier' })).toContain('businessAddress');
    expect(fields({ ...EMPTY, applicantType: 'company' })).toContain('businessAddress');
  });

  it('is the RESIDENTIAL address for an owner-operator', () => {
    const out = fields({ ...EMPTY, applicantType: 'owner_operator' });
    expect(out).toContain('residentialAddress');
    expect(out).not.toContain('businessAddress');
  });

  it('offers neither while the type is unset — the form has no field to put it in yet', () => {
    const out = fields({ ...EMPTY, applicantType: null });
    expect(out).not.toContain('businessAddress');
    expect(out).not.toContain('residentialAddress');
  });
});

describe('principals', () => {
  it('offers the FMCSA owner only when the case has none', () => {
    expect(fields({ ...EMPTY, principalCount: 0 })).toContain('principalName');
    expect(fields({ ...EMPTY, principalCount: 1 })).not.toContain('principalName');
  });

  it('never offers one to an owner-operator — Flow A has no principals section', () => {
    expect(fields({ ...EMPTY, applicantType: 'owner_operator' })).not.toContain('principalName');
  });
});

describe('trucks', () => {
  it('prefers power units and falls back to truck size', () => {
    expect(suggestionsFor(EMPTY, MATCH).find((s) => s.field === 'trucksCount')?.value).toBe('4');
    expect(
      suggestionsFor(EMPTY, { ...MATCH, powerUnits: null }).find((s) => s.field === 'trucksCount')
        ?.value,
    ).toBe('6');
  });

  it('does not offer a zero fleet', () => {
    expect(fields(EMPTY, { ...MATCH, powerUnits: 0, truckSize: 0 })).not.toContain('trucksCount');
  });
});

describe('phone normalisation', () => {
  it('reduces every format the two systems use to the same digits', () => {
    for (const form of ['(614) 555-0110', '614-555-0110', '+1 614 555 0110', '16145550110']) {
      expect(normalisePhone(form), form).toBe('6145550110');
    }
  });

  it('refuses anything too short to be a number', () => {
    expect(normalisePhone('555-0110')).toBeNull();
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
  });
});
