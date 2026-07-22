import { describe, expect, it } from 'vitest';
import type { CarrierInvitation } from '../../api/carrierUsers';
import { expiresSoon, inviteStatus, isLiveInvite, relativeTime } from './carrierUserUtil';

const NOW = new Date('2026-07-17T12:00:00Z').getTime();
const hours = (n: number) => new Date(NOW + n * 3_600_000).toISOString();

function invite(over: Partial<CarrierInvitation> = {}): CarrierInvitation {
  return {
    id: 'i1',
    profile: 'owner',
    carrierId: '5758544',
    applicationId: null,
    companyName: 'Acme Transport LLC',
    cardId: null,
    driverName: null,
    companyType: null,
    cardCount: null,
    agentName: null,
    agentZohoUserId: null,
    status: 'pending',
    expiresAt: hours(48),
    createdAt: hours(-24),
    inviteUrl: 'https://t.me/bot?start=abc',
    ...over,
  };
}

describe('inviteStatus', () => {
  // The backend leaves an invite `pending` until something tries to redeem it, so the elapsed
  // expiry is only visible if the table works it out — otherwise a dead link reads as live.
  it('reports an elapsed pending invite as expired', () => {
    expect(inviteStatus(invite({ expiresAt: hours(-1) }), NOW)).toBe('expired');
    expect(inviteStatus(invite({ expiresAt: hours(1) }), NOW)).toBe('pending');
  });

  it('leaves a settled status alone even once the expiry has passed', () => {
    expect(inviteStatus(invite({ status: 'redeemed', expiresAt: hours(-100) }), NOW)).toBe('redeemed');
    expect(inviteStatus(invite({ status: 'cancelled', expiresAt: hours(-100) }), NOW)).toBe('cancelled');
  });

  it('counts only an unexpired pending invite as live', () => {
    expect(isLiveInvite(invite({ expiresAt: hours(1) }), NOW)).toBe(true);
    expect(isLiveInvite(invite({ expiresAt: hours(-1) }), NOW)).toBe(false);
    expect(isLiveInvite(invite({ status: 'redeemed' }), NOW)).toBe(false);
  });
});

describe('expiresSoon', () => {
  it('flags a live invite inside the last day, and nothing else', () => {
    expect(expiresSoon(invite({ expiresAt: hours(5) }), NOW)).toBe(true);
    expect(expiresSoon(invite({ expiresAt: hours(30) }), NOW)).toBe(false);
    // Already dead — the row says Expired, so a warning on top would be noise.
    expect(expiresSoon(invite({ expiresAt: hours(-1) }), NOW)).toBe(false);
    expect(expiresSoon(invite({ status: 'redeemed', expiresAt: hours(5) }), NOW)).toBe(false);
  });
});

describe('relativeTime', () => {
  it('scales the unit to the distance, in both directions', () => {
    expect(relativeTime(hours(48), NOW)).toBe('in 2 days');
    expect(relativeTime(hours(5), NOW)).toBe('in 5 hours');
    expect(relativeTime(hours(-3), NOW)).toBe('3 hours ago');
    expect(relativeTime(new Date(NOW + 120_000).toISOString(), NOW)).toBe('in 2 minutes');
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
});
