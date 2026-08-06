import { beforeEach, describe, expect, it } from 'vitest';
import { readManagerUrlState, writeManagerUrlState } from './managerUrlState';

function setUrl(search: string): void {
  window.history.replaceState(null, '', `/m/manager${search}`);
}

describe('manager URL state', () => {
  beforeEach(() => setUrl(''));

  it('reads nothing from a bare URL', () => {
    expect(readManagerUrlState()).toEqual({ view: null, carrier: null, tab: null });
  });

  it('round-trips a carrier view', () => {
    writeManagerUrlState({ view: 'efs', carrier: '5724546', tab: 'cards' }, 'replace');
    expect(window.location.search).toContain('card=efs');
    expect(readManagerUrlState()).toEqual({ view: 'efs', carrier: '5724546', tab: 'cards' });
  });

  it('clears keys it owns when they go null', () => {
    writeManagerUrlState({ view: 'efs', carrier: '5724546', tab: 'cards' }, 'replace');
    writeManagerUrlState({ view: null, carrier: null, tab: null }, 'replace');
    expect(window.location.search).toBe('');
  });

  it('leaves query params it does not own alone', () => {
    // The Zoho OAuth callback lands on `?code=…`; clobbering the whole query string here would
    // break the handshake, so only the three manager keys may be touched.
    setUrl('?code=abc123&state=xyz');
    writeManagerUrlState({ view: 'efs', carrier: '5724546', tab: null }, 'replace');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('code')).toBe('abc123');
    expect(params.get('state')).toBe('xyz');
    expect(params.get('card')).toBe('efs');
  });

  it('treats blank values as absent rather than as an empty selection', () => {
    setUrl('?card=&carrier=%20');
    expect(readManagerUrlState()).toEqual({ view: null, carrier: null, tab: null });
  });

  it('does not push a history entry when nothing changed', () => {
    writeManagerUrlState({ view: 'efs', carrier: null, tab: null }, 'replace');
    const before = window.history.length;
    writeManagerUrlState({ view: 'efs', carrier: null, tab: null }, 'push');
    expect(window.history.length).toBe(before);
  });
});
