import { describe, expect, it } from 'vitest';
import { RC_ALLOWED_MYTRIONS, isRingCentralRoute, mytrionFromPath } from './rcRouteGate';
import { MYTRION_URL_SLUG } from '@/access/mytrions.config';

describe('isRingCentralRoute', () => {
  it('refuses the workspace launcher', () => {
    // The stated requirement: "not in main workspace as well". `/main` has no segment after it, so
    // the pattern cannot match — this pins that by construction rather than by inspection.
    expect(isRingCentralRoute('/main')).toBe(false);
    expect(isRingCentralRoute('/main/')).toBe(false);
  });

  it('refuses non-worker routes', () => {
    expect(isRingCentralRoute('/')).toBe(false);
    expect(isRingCentralRoute('/kitchen')).toBe(false);
    expect(isRingCentralRoute('/client')).toBe(false);
  });

  it('allows exactly the three desk-phone Mytrions', () => {
    expect(isRingCentralRoute('/main/salesmytrion')).toBe(true);
    expect(isRingCentralRoute('/main/csmytrion')).toBe(true);
    expect(isRingCentralRoute('/main/collectionmytrion')).toBe(true);
  });

  it('refuses every other Mytrion', () => {
    const denied = Object.entries(MYTRION_URL_SLUG).filter(
      ([id]) => !RC_ALLOWED_MYTRIONS.has(id as never),
    );
    // Guards against the set being widened without a matching decision — if someone adds a Mytrion
    // to RC_ALLOWED_MYTRIONS, this shrinks rather than failing, so assert it still covers most of them.
    expect(denied.length).toBeGreaterThan(5);
    for (const [, slug] of denied) {
      expect(isRingCentralRoute(`/main/${slug}`)).toBe(false);
    }
  });

  it('refuses an unknown slug', () => {
    expect(isRingCentralRoute('/main/notaslug')).toBe(false);
  });

  it('refuses a Mytrion ID used as a slug', () => {
    // `sales` is the ID; `salesmytrion` is the slug. Easy to conflate, and the wrong one must not pass.
    expect(isRingCentralRoute('/main/sales')).toBe(false);
    expect(isRingCentralRoute('/main/customer-service')).toBe(false);
  });

  it('allows sub-routes of an allowed Mytrion', () => {
    // The pattern is prefix-anchored on purpose. Pin it before someone "tightens" it with `$` and
    // silently kills the softphone everywhere but a workspace's index route.
    expect(isRingCentralRoute('/main/salesmytrion/records')).toBe(true);
    expect(isRingCentralRoute('/main/csmytrion/applications/42')).toBe(true);
  });

  it('handles the legacy /m/:id form, which carries IDs not slugs', () => {
    expect(isRingCentralRoute('/m/sales')).toBe(true);
    expect(isRingCentralRoute('/m/customer-service')).toBe(true);
    expect(isRingCentralRoute('/m/collection')).toBe(true);
    expect(isRingCentralRoute('/m/hr')).toBe(false);
    expect(isRingCentralRoute('/m/bogus')).toBe(false);
  });
});

describe('mytrionFromPath', () => {
  it('resolves slugs on /main and IDs on /m', () => {
    expect(mytrionFromPath('/main/csmytrion')).toBe('customer-service');
    expect(mytrionFromPath('/m/customer-service')).toBe('customer-service');
  });

  it('returns undefined off a Mytrion route', () => {
    expect(mytrionFromPath('/main')).toBeUndefined();
    expect(mytrionFromPath('/kitchen')).toBeUndefined();
  });

  it('resolves every registered slug, so the gate can never see an unmappable workspace', () => {
    for (const [id, slug] of Object.entries(MYTRION_URL_SLUG)) {
      expect(mytrionFromPath(`/main/${slug}`)).toBe(id);
    }
  });
});
