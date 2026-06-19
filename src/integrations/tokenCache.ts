/**
 * Reusable cached-token provider for platform auth (CMP, EFS, …). Holds a value for a TTL,
 * coalesces concurrent fetches into one in-flight promise (no thundering herd on first auth or
 * after expiry), and supports forced refresh (e.g. after a downstream 401) + cache clear.
 *
 * Generic over the cached value so it works for a bearer string, a SOAP session token, etc.
 */
export interface TokenProvider<T> {
  /** Cached value if fresh, else fetch (sharing any in-flight fetch). */
  get(): Promise<T>;
  /** Discard the cached value and fetch a new one immediately. */
  forceRefresh(): Promise<T>;
  /** Drop the cache without fetching; next get() re-fetches. */
  clear(): void;
}

export interface TokenProviderOptions<T> {
  /** Token lifetime in ms. */
  ttlMs: number;
  /** Refresh this many ms before expiry to avoid edge-of-expiry failures. */
  skewMs?: number;
  /** Fetch a fresh value (the actual auth call). */
  fetch: () => Promise<T>;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export function createTokenProvider<T>(opts: TokenProviderOptions<T>): TokenProvider<T> {
  const skew = opts.skewMs ?? 0;
  const clock = opts.now ?? Date.now;
  let value: T | null = null;
  let expiresAt = 0;
  let inflight: Promise<T> | null = null;

  function load(): Promise<T> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const fresh = await opts.fetch();
        value = fresh;
        expiresAt = clock() + opts.ttlMs;
        return fresh;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    async get(): Promise<T> {
      if (value !== null && clock() < expiresAt - skew) return value;
      return load();
    },
    async forceRefresh(): Promise<T> {
      value = null;
      expiresAt = 0;
      return load();
    },
    clear(): void {
      value = null;
      expiresAt = 0;
      inflight = null;
    },
  };
}
