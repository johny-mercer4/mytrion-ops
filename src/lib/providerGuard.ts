/**
 * Process-local provider bulkhead + circuit breaker.
 *
 * It deliberately has no provider SDK dependencies, so every HTTP wrapper shares one bounded
 * concurrency policy. The API stays small enough to replace with a distributed coordinator later
 * without changing route or service call sites.
 */
export class ProviderBusyError extends Error {
  constructor(readonly provider: string, message = `Provider ${provider} is temporarily busy`) {
    super(message);
    this.name = 'ProviderBusyError';
  }
}

interface Waiting {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ProviderState {
  active: number;
  queue: Waiting[];
  consecutiveFailures: number;
  openUntil: number;
}

export interface ProviderRunOptions<T> {
  isFailure?: (value: T) => boolean;
}

const FAILURE_THRESHOLD = 5;
const OPEN_MS = 30_000;
const MAX_QUEUE = 100;

function concurrencyFor(provider: string): number {
  if (provider.startsWith('zoho_')) return 4;
  if (provider === 'server_crm') return 8;
  if (provider === 'ringcentral') return 4;
  return 6;
}

export class ProviderGuard {
  private readonly states = new Map<string, ProviderState>();

  async run<T>(provider: string, task: () => Promise<T>, options: ProviderRunOptions<T> = {}): Promise<T> {
    await this.acquire(provider);
    const state = this.state(provider);
    try {
      const value = await task();
      if (options.isFailure?.(value)) this.recordFailure(state);
      else this.recordSuccess(state);
      return value;
    } catch (error) {
      this.recordFailure(state);
      throw error;
    } finally {
      this.release(provider);
    }
  }

  reset(): void {
    this.states.clear();
  }

  private state(provider: string): ProviderState {
    let state = this.states.get(provider);
    if (!state) {
      state = { active: 0, queue: [], consecutiveFailures: 0, openUntil: 0 };
      this.states.set(provider, state);
    }
    return state;
  }

  private circuitError(provider: string, state: ProviderState): ProviderBusyError | null {
    if (state.openUntil <= Date.now()) {
      if (state.openUntil) {
        state.openUntil = 0;
        state.consecutiveFailures = 0;
      }
      return null;
    }
    return new ProviderBusyError(provider, `Provider ${provider} circuit is open`);
  }

  private acquire(provider: string): Promise<void> {
    const state = this.state(provider);
    const open = this.circuitError(provider, state);
    if (open) return Promise.reject(open);
    if (state.active < concurrencyFor(provider)) {
      state.active += 1;
      return Promise.resolve();
    }
    if (state.queue.length >= MAX_QUEUE) return Promise.reject(new ProviderBusyError(provider));
    return new Promise((resolve, reject) => state.queue.push({ resolve, reject }));
  }

  private release(provider: string): void {
    const state = this.state(provider);
    state.active = Math.max(0, state.active - 1);
    while (state.queue.length && state.active < concurrencyFor(provider)) {
      const next = state.queue.shift();
      if (!next) return;
      const open = this.circuitError(provider, state);
      if (open) {
        next.reject(open);
        continue;
      }
      state.active += 1;
      next.resolve();
    }
  }

  private recordSuccess(state: ProviderState): void {
    state.consecutiveFailures = 0;
    state.openUntil = 0;
  }

  private recordFailure(state: ProviderState): void {
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= FAILURE_THRESHOLD) state.openUntil = Date.now() + OPEN_MS;
  }
}

export const providerGuard = new ProviderGuard();
