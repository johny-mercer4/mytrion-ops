/**
 * Wrapper core (integrations/core) — the base-class contracts every vendor wrapper relies on:
 * request() auth + error factory, retry-exactly-once after 401, health() never throwing, and
 * the registry's lazy handles not importing their module until asked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BaseWrapper,
  HttpWrapper,
  WrapperHttpError,
  type HttpMethod,
} from '../../src/integrations/core/base.js';
import {
  clearWrapperRegistry,
  registerWrapper,
  wrapperHealthAll,
} from '../../src/integrations/core/registry.js';

/** Minimal HTTP wrapper over a stubbed global fetch. */
class TestHttpWrapper extends HttpWrapper {
  readonly name = 'test_http';
  authCalls = 0;
  unauthorizedCalls = 0;
  retryAfter401 = false;

  isConfigured(): boolean {
    return true;
  }
  protected baseUrl(): string {
    return 'https://vendor.example/api/';
  }
  protected authHeaders(): Promise<Record<string, string>> {
    this.authCalls += 1;
    return Promise.resolve({ Authorization: `Bearer t${this.authCalls}` });
  }
  protected override onUnauthorized(): Promise<boolean> {
    this.unauthorizedCalls += 1;
    return Promise.resolve(this.retryAfter401);
  }
  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, query ? { query } : {});
  }
}

function stubFetch(responses: Array<{ status: number; body?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(r?.body ?? '', { status: r?.status ?? 200 });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearWrapperRegistry();
});

describe('HttpWrapper.request', () => {
  it('attaches auth headers, builds the URL from baseUrl + query, parses JSON', async () => {
    const calls = stubFetch([{ status: 200, body: '{"ok":true}' }]);
    const w = new TestHttpWrapper();
    const out = await w.get<{ ok: boolean }>('/things', { q: 'x', skip: undefined });
    expect(out).toEqual({ ok: true });
    expect(calls[0]?.url).toBe('https://vendor.example/api/things?q=x');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer t1');
  });

  it('empty body → {}', async () => {
    stubFetch([{ status: 200, body: '' }]);
    expect(await new TestHttpWrapper().get('/empty')).toEqual({});
  });

  it('non-2xx throws a WrapperHttpError carrying the status + truncated body', async () => {
    stubFetch([{ status: 503, body: 'upstream down' }]);
    const err = await new TestHttpWrapper().get('/broken').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WrapperHttpError);
    expect((err as WrapperHttpError).status).toBe(503);
    expect((err as WrapperHttpError).message).toContain('[test_http] GET /broken → HTTP 503');
  });

  it('retries EXACTLY once after a 401 when onUnauthorized says so, with fresh auth', async () => {
    const calls = stubFetch([{ status: 401 }, { status: 200, body: '{"ok":1}' }]);
    const w = new TestHttpWrapper();
    w.retryAfter401 = true;
    expect(await w.get('/secure')).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
    expect((calls[1]?.init.headers as Record<string, string>).Authorization).toBe('Bearer t2');
    expect(w.unauthorizedCalls).toBe(1);
  });

  it('a second consecutive 401 is NOT retried again (no loop)', async () => {
    const calls = stubFetch([{ status: 401 }, { status: 401 }]);
    const w = new TestHttpWrapper();
    w.retryAfter401 = true;
    const err = await w.get('/secure').catch((e: unknown) => e);
    expect((err as WrapperHttpError).status).toBe(401);
    expect(calls).toHaveLength(2);
    expect(w.unauthorizedCalls).toBe(1);
  });

  it('does not retry when onUnauthorized declines', async () => {
    const calls = stubFetch([{ status: 401 }]);
    const err = await new TestHttpWrapper().get('/secure').catch((e: unknown) => e);
    expect((err as WrapperHttpError).status).toBe(401);
    expect(calls).toHaveLength(1);
  });

  it('httpError() override controls the thrown error (historical formats preserved)', async () => {
    class LegacyFormat extends TestHttpWrapper {
      protected override httpError(m: HttpMethod, p: string, s: number, b: string): Error {
        return new Error(`[legacy] ${m} ${p} → HTTP ${s}: ${b.slice(0, 10)}`);
      }
    }
    stubFetch([{ status: 500, body: 'boom' }]);
    const err = await new LegacyFormat().get('/x').catch((e: unknown) => e);
    expect((err as Error).message).toBe('[legacy] GET /x → HTTP 500: boom');
  });
});

describe('BaseWrapper.health', () => {
  class Probing extends BaseWrapper {
    readonly name = 'probing';
    readonly kind = 'sdk' as const;
    constructor(
      private readonly configured: boolean,
      private readonly probeErr?: Error,
    ) {
      super();
    }
    isConfigured(): boolean {
      return this.configured;
    }
    protected override probe(): Promise<void> {
      return this.probeErr ? Promise.reject(this.probeErr) : Promise.resolve();
    }
  }

  it('unconfigured → configured:false, ok:false, no probe', async () => {
    expect(await new Probing(false).health({ live: true })).toMatchObject({
      configured: false,
      ok: false,
      detail: 'unconfigured',
    });
  });

  it('configured, non-live → ok without probing', async () => {
    expect(await new Probing(true, new Error('never called')).health()).toMatchObject({
      configured: true,
      ok: true,
    });
  });

  it('live probe failure NEVER throws — lands in ok:false + detail', async () => {
    const h = await new Probing(true, new Error('connect ECONNREFUSED')).health({ live: true });
    expect(h.ok).toBe(false);
    expect(h.configured).toBe(true);
    expect(h.detail).toContain('ECONNREFUSED');
    expect(h.latencyMs).toBeTypeOf('number');
  });
});

describe('registry', () => {
  it('lazy handles are not loaded until configured AND asked', async () => {
    const load = vi.fn(async () => {
      throw new Error('should not be called');
    });
    registerWrapper({ name: 'lazy_off', kind: 'sdk', isConfigured: () => false, load });
    const all = await wrapperHealthAll();
    expect(all).toEqual([
      { name: 'lazy_off', kind: 'sdk', configured: false, ok: false, detail: 'unconfigured' },
    ]);
    expect(load).not.toHaveBeenCalled();
  });

  it('a configured lazy handle loads and reports the real wrapper health', async () => {
    class Real extends BaseWrapper {
      readonly name = 'lazy_on';
      readonly kind = 'sdk' as const;
      isConfigured(): boolean {
        return true;
      }
    }
    registerWrapper({ name: 'lazy_on', kind: 'sdk', isConfigured: () => true, load: async () => new Real() });
    const all = await wrapperHealthAll();
    expect(all).toEqual([{ name: 'lazy_on', kind: 'sdk', configured: true, ok: true }]);
  });

  it('a lazy load failure is contained (never throws)', async () => {
    registerWrapper({
      name: 'lazy_broken',
      kind: 'sdk',
      isConfigured: () => true,
      load: async () => {
        throw new Error('module exploded');
      },
    });
    const all = await wrapperHealthAll();
    expect(all[0]).toMatchObject({ name: 'lazy_broken', configured: true, ok: false });
    expect(all[0]?.detail).toContain('module exploded');
  });
});
