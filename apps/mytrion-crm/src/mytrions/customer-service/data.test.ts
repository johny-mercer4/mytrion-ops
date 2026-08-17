import { describe, expect, it } from 'vitest';
import { missingRequiredFieldLabels } from './data';
import type { Application } from './data';

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: '1',
    appId: '1',
    company: 'Acme',
    first: 'Jane',
    last: 'Doe',
    biz: 'LLC',
    stage: '',
    wex: '',
    mc: '',
    dot: '',
    phone: '',
    email: '',
    street: '',
    city: 'Chicago',
    state: 'IL',
    zip: '60612',
    credit: null,
    trucks: 0,
    cards: 0,
    date: '',
    dateFilledRaw: '',
    agent: '',
    notes: '',
    cycle: '',
    pay: '',
    ta: 0,
    efs: 0,
    lmt: 0,
    mob: 0,
    chn: 0,
    verified: false,
    carrierId: '',
    lovesVerification: '',
    ...overrides,
  };
}

describe('missingRequiredFieldLabels', () => {
  it('is empty when First/Last Name, City, and Zip are all present', () => {
    expect(missingRequiredFieldLabels(app())).toEqual([]);
  });

  it('lists every blank required field, in a fixed order', () => {
    expect(missingRequiredFieldLabels(app({ first: '', last: '', city: '', zip: '' }))).toEqual([
      'First Name',
      'Last Name',
      'City',
      'Zip Code',
    ]);
  });

  it('treats whitespace-only values as blank', () => {
    expect(missingRequiredFieldLabels(app({ first: '   ' }))).toEqual(['First Name']);
  });

  it('does not flag unrelated blank fields (e.g. notes, credit score)', () => {
    expect(missingRequiredFieldLabels(app({ notes: '', credit: null }))).toEqual([]);
  });
});
