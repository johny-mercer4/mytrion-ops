/**
 * Short per-user debounce for Telegram's natural "one thought across several messages" style.
 * Keys are `(chat,user)`, so one client's typing never blocks another client's request.
 */
export interface MessageBurstOptions<T> {
  quietMs: number;
  maxWaitMs: number;
  maxKeys?: number;
  maxItemsPerKey?: number;
  quietMsFor?: (items: readonly T[]) => number;
  onFlush: (items: readonly T[]) => Promise<void> | void;
  onError?: (error: unknown) => void;
  onOverflow?: (kind: 'keys' | 'items', key: string) => void;
}

interface PendingBurst<T> {
  items: T[];
  startedAt: number;
  timer: NodeJS.Timeout | null;
}

export class MessageBurstBuffer<T> {
  private readonly pending = new Map<string, PendingBurst<T>>();

  constructor(private readonly options: MessageBurstOptions<T>) {
    if (options.quietMs < 0 || options.maxWaitMs <= 0) {
      throw new Error('message burst timing must be positive');
    }
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  push(key: string, item: T): boolean {
    const existing = this.pending.get(key);
    if (existing) {
      if (existing.items.length >= (this.options.maxItemsPerKey ?? Number.MAX_SAFE_INTEGER)) {
        existing.items.shift();
        this.options.onOverflow?.('items', key);
      }
      existing.items.push(item);
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = this.schedule(key, existing);
      return true;
    }

    if (this.pending.size >= (this.options.maxKeys ?? Number.MAX_SAFE_INTEGER)) {
      this.options.onOverflow?.('keys', key);
      return false;
    }

    const startedAt = Date.now();
    this.pending.set(key, {
      items: [item],
      startedAt,
      timer: null,
    });
    const created = this.pending.get(key);
    if (created) {
      created.timer = this.schedule(key, created);
    }
    return true;
  }

  async flush(key: string): Promise<void> {
    const burst = this.pending.get(key);
    if (!burst) return;
    this.pending.delete(key);
    if (burst.timer) clearTimeout(burst.timer);
    await this.options.onFlush(burst.items);
  }

  async flushAll(): Promise<void> {
    for (const key of [...this.pending.keys()]) await this.flush(key);
  }

  private schedule(key: string, burst: PendingBurst<T>): NodeJS.Timeout {
    const remaining = Math.max(
      0,
      this.options.maxWaitMs - (Date.now() - burst.startedAt),
    );
    const requestedQuiet =
      this.options.quietMsFor?.(burst.items) ?? this.options.quietMs;
    const delay = Math.min(Math.max(0, requestedQuiet), remaining);
    const timer = setTimeout(() => {
      void this.flush(key).catch((error: unknown) =>
        this.options.onError?.(error),
      );
    }, delay);
    timer.unref();
    return timer;
  }
}
