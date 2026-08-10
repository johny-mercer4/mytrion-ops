import { describe, expect, it } from 'vitest';
import {
  cardLast6,
  loginForRegistration,
  normalizeLogin,
} from '../../src/modules/carrier/miniAppPasswordAuth.js';

describe('mini-app password login keys', () => {
  it('normalizes login names case-insensitively with collapsed spaces', () => {
    expect(normalizeLogin('  Acme   Fleet  ')).toBe('acme fleet');
  });

  it('builds owner login from company name', () => {
    expect(
      loginForRegistration({
        profile: 'owner',
        companyName: 'ZURVAN INC',
        driverName: null,
        cardId: null,
      }),
    ).toBe('zurvan inc');
  });

  it('builds manager login from manager name (driverName column)', () => {
    expect(
      loginForRegistration({
        profile: 'manager',
        companyName: 'ZURVAN INC',
        driverName: 'Alex Manager',
        cardId: null,
      }),
    ).toBe('alex manager');
  });

  it('builds driver login from last 6 card digits', () => {
    expect(cardLast6('7083050030888967549')).toBe('8967549'.slice(-6));
    expect(
      loginForRegistration({
        profile: 'driver',
        companyName: 'ZURVAN INC',
        driverName: 'James',
        cardId: '7083 0500 3088 8967 549',
      }),
    ).toBe('8967549'.slice(-6));
  });
});
