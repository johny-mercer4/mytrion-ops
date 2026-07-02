import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import {
  assertUrlsAllowed,
  buildBrowserTools,
  extractUrls,
  isBrowserWriteTool,
  isHostAllowed,
} from '../../src/modules/agents/tools/browserTools.js';
import { takeToken, resetRateBucketsForTests } from '../../src/modules/security/rateBucket.js';
import { makeContext } from '../fixtures/seed.js';

const saved = {
  domains: env.BROWSER_ALLOWED_DOMAINS,
  browser: env.FF_BROWSER_ENABLED,
};
afterEach(() => {
  env.BROWSER_ALLOWED_DOMAINS = saved.domains;
  env.FF_BROWSER_ENABLED = saved.browser;
  resetRateBucketsForTests();
});

describe('domain allowlist (fail closed)', () => {
  it('empty allowlist denies every URL-carrying action', () => {
    env.BROWSER_ALLOWED_DOMAINS = '';
    expect(() => assertUrlsAllowed({ url: 'https://example.com/page' })).toThrow(/blocked/);
  });

  it('suffix match allows subdomains, never lookalike hosts', () => {
    expect(isHostAllowed('safer.fmcsa.dot.gov', ['fmcsa.dot.gov'])).toBe(true);
    expect(isHostAllowed('fmcsa.dot.gov', ['fmcsa.dot.gov'])).toBe(true);
    expect(isHostAllowed('evil-fmcsa.dot.gov.attacker.com', ['fmcsa.dot.gov'])).toBe(false);
    expect(isHostAllowed('notfmcsa.dot.gov', ['fmcsa.dot.gov'])).toBe(false);
  });

  it('finds URLs nested anywhere in the arguments', () => {
    const urls = extractUrls({
      a: 'scrape https://one.test/x please',
      b: { c: ['https://two.test'] },
    });
    expect(urls).toEqual(['https://one.test/x', 'https://two.test']);
  });

  it('allows non-URL actions and allowlisted hosts', () => {
    env.BROWSER_ALLOWED_DOMAINS = 'one.test, fmcsa.dot.gov';
    expect(() => assertUrlsAllowed({ query: 'no urls here' })).not.toThrow();
    expect(() => assertUrlsAllowed({ url: 'https://sub.one.test/page' })).not.toThrow();
    expect(() => assertUrlsAllowed({ url: 'https://evil.test' })).toThrow(/blocked/);
  });
});

describe('browser write-verb classification', () => {
  it('interactive actions are write-class; scrape/search/extract are read-class', () => {
    expect(isBrowserWriteTool('BROWSERBASE_NAVIGATE')).toBe(true);
    expect(isBrowserWriteTool('BROWSER_TOOL_CLICK_ELEMENT')).toBe(true);
    expect(isBrowserWriteTool('BROWSERBASE_FILL_FORM')).toBe(true);
    expect(isBrowserWriteTool('FIRECRAWL_SCRAPE')).toBe(false);
    expect(isBrowserWriteTool('FIRECRAWL_SEARCH')).toBe(false);
    expect(isBrowserWriteTool('FIRECRAWL_EXTRACT')).toBe(false);
  });
});

describe('gates', () => {
  it('flag off → no tools, no Composio contact', async () => {
    env.FF_BROWSER_ENABLED = false;
    const tools = await buildBrowserTools(makeContext({ allDepartmentAccess: true }));
    expect(tools).toEqual([]);
  });
});

describe('rate bucket', () => {
  it('caps per key per minute and refills after the window', () => {
    let now = 0;
    const clock = (): number => now;
    expect(takeToken('composio:FIRECRAWL', 2, clock)).toBe(true);
    expect(takeToken('composio:FIRECRAWL', 2, clock)).toBe(true);
    expect(takeToken('composio:FIRECRAWL', 2, clock)).toBe(false);
    expect(takeToken('composio:OTHER', 2, clock)).toBe(true); // independent keys
    now = 61_000;
    expect(takeToken('composio:FIRECRAWL', 2, clock)).toBe(true);
  });
});
