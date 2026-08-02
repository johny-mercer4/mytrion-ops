/** Bounded process-local SWR cache with in-flight coalescing and stale-if-error fallback. */
export interface AsyncCacheResult<T> {
  data: T;
  freshness: 'fresh' | 'stale';
  generatedAt: string;
  staleReason?: string;
}

interface Entry<T> {
  data: T;
  storedAt: number;
}

export class AsyncSWRCache {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<AsyncCacheResult<unknown>>>();

  constructor(private readonly maxEntries = 250) {}

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    options: { ttlMs: number; staleIfErrorMs?: number; force?: boolean },
  ): Promise<AsyncCacheResult<T>> {
    const hit = this.entries.get(key) as Entry<T> | undefined;
    const now = Date.now();
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      if (!options.force && now - hit.storedAt < options.ttlMs) {
        return { data: hit.data, freshness: 'fresh', generatedAt: new Date(hit.storedAt).toISOString() };
      }
    }

    const running = this.inflight.get(key) as Promise<AsyncCacheResult<T>> | undefined;
    if (running) return running;

    const promise = loader()
      .then((data): AsyncCacheResult<T> => {
        const storedAt = Date.now();
        this.entries.delete(key);
        this.entries.set(key, { data, storedAt });
        this.prune();
        return { data, freshness: 'fresh', generatedAt: new Date(storedAt).toISOString() };
      })
      .catch((error: unknown): AsyncCacheResult<T> => {
        const staleWindow = options.staleIfErrorMs ?? 0;
        if (hit && now - hit.storedAt <= staleWindow) {
          return {
            data: hit.data,
            freshness: 'stale',
            generatedAt: new Date(hit.storedAt).toISOString(),
            staleReason: error instanceof Error ? error.message : 'Upstream request failed',
          };
        }
        throw error;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise as Promise<AsyncCacheResult<unknown>>);
    return promise;
  }

  invalidate(prefix: string): void {
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
    for (const key of [...this.inflight.keys()]) if (key.startsWith(prefix)) this.inflight.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  private prune(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) return;
      this.entries.delete(oldest);
    }
  }
}
