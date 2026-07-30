import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiConfig, v1Url } from './config';

describe('resolveApiConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses same-origin on a deployed host even if VITE_API_URL is set', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'octane-ops-ai.onrender.com' },
    });
    expect(resolveApiConfig()).toEqual({ baseUrl: '' });
  });

  it('allows VITE_API_URL only on localhost in non-PROD', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'localhost' },
    });
    const cfg = resolveApiConfig();
    // In vitest (DEV), localhost may resolve to the env URL or '' depending on .env — never a
    // remote host, and never throw.
    expect(typeof cfg.baseUrl).toBe('string');
    if (cfg.baseUrl) {
      expect(cfg.baseUrl).toMatch(/^https?:\/\/localhost(?::\d+)?\/?$/);
    }
  });
});

describe('v1Url', () => {
  it('prefixes /v1 for empty base (same-origin)', () => {
    expect(v1Url('', '/auth/zoho/login')).toBe('/v1/auth/zoho/login');
  });

  it('joins an absolute base once', () => {
    expect(v1Url('http://localhost:3001', '/auth/zoho/login')).toBe(
      'http://localhost:3001/v1/auth/zoho/login',
    );
  });
});
