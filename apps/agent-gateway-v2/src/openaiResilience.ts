import { config } from './config.js';
import { incrementCounter } from './metrics.js';
import { GatewayOverloadError } from './overload.js';

interface TokenBucket {
  tokens: number;
  capacity: number;
  refillPerMs: number;
  updatedAt: number;
}

export interface OpenAIRequestOptions<T> {
  estimatedTokens: number;
  deadlineAt?: number;
  operation: () => Promise<T>;
  usageTokens?: (result: T) => number;
}

export interface OpenAIResilienceSnapshot {
  rpmLimit: number;
  tpmLimit: number;
  requestTokens: number;
  modelTokens: number;
  consecutive429s: number;
  circuitOpenUntil: number;
}

interface OpenAIResilienceOptions {
  rpmLimit: number;
  tpmLimit: number;
  maxRateWaitMs: number;
  max429Retries: number;
  circuit429Threshold: number;
  circuitCooldownMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function refill(bucket: TokenBucket, now: number): void {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillPerMs);
  bucket.updatedAt = now;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = error.status;
  return typeof status === 'number' ? status : undefined;
}

function headerValue(error: unknown, name: string): string | undefined {
  if (!error || typeof error !== 'object' || !('headers' in error)) return undefined;
  const headers = error.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  if ('get' in headers && typeof headers.get === 'function') {
    const value = headers.get(name);
    return typeof value === 'string' ? value : undefined;
  }
  const record = headers as Record<string, unknown>;
  const value = record[name] ?? record[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

export function retryAfterMs(error: unknown, now = Date.now()): number {
  const milliseconds = Number(headerValue(error, 'retry-after-ms'));
  if (Number.isFinite(milliseconds) && milliseconds > 0) {
    return Math.ceil(milliseconds);
  }
  const raw = headerValue(error, 'retry-after');
  if (!raw) return 1_000;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1, date - now) : 1_000;
}

export function approximateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export class OpenAIResilienceController {
  private readonly requestBucket: TokenBucket;
  private readonly modelBucket: TokenBucket;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private consecutive429s = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly options: OpenAIResilienceOptions) {
    const startedAt = options.now?.() ?? Date.now();
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.requestBucket = {
      tokens: options.rpmLimit,
      capacity: options.rpmLimit,
      refillPerMs: options.rpmLimit / 60_000,
      updatedAt: startedAt,
    };
    this.modelBucket = {
      tokens: options.tpmLimit,
      capacity: options.tpmLimit,
      refillPerMs: options.tpmLimit / 60_000,
      updatedAt: startedAt,
    };
  }

  private assertCircuitClosed(): void {
    const now = this.now();
    if (this.circuitOpenUntil <= now) return;
    incrementCounter('openai_overload_rejected_total');
    throw new GatewayOverloadError(
      'circuit_open',
      'OpenAI circuit breaker is open',
      this.circuitOpenUntil - now,
    );
  }

  private async reserve(estimatedTokens: number, deadlineAt?: number): Promise<number> {
    if (estimatedTokens > this.modelBucket.capacity) {
      incrementCounter('openai_overload_rejected_total');
      throw new GatewayOverloadError(
        'rate_limit',
        'Estimated request exceeds the configured OpenAI TPM capacity',
      );
    }
    const reservation = Math.min(
      this.modelBucket.capacity,
      Math.max(1, Math.ceil(estimatedTokens)),
    );
    for (;;) {
      this.assertCircuitClosed();
      const now = this.now();
      refill(this.requestBucket, now);
      refill(this.modelBucket, now);
      if (this.requestBucket.tokens >= 1 && this.modelBucket.tokens >= reservation) {
        this.requestBucket.tokens -= 1;
        this.modelBucket.tokens -= reservation;
        return reservation;
      }
      const requestWait =
        this.requestBucket.tokens >= 1
          ? 0
          : (1 - this.requestBucket.tokens) / this.requestBucket.refillPerMs;
      const tokenWait =
        this.modelBucket.tokens >= reservation
          ? 0
          : (reservation - this.modelBucket.tokens) / this.modelBucket.refillPerMs;
      const waitMs = Math.max(1, Math.ceil(Math.max(requestWait, tokenWait)));
      const availableMs = deadlineAt === undefined ? Infinity : deadlineAt - now;
      if (waitMs > this.options.maxRateWaitMs || waitMs > availableMs) {
        incrementCounter('openai_overload_rejected_total');
        throw new GatewayOverloadError(
          'rate_limit',
          'OpenAI RPM/TPM admission wait exceeded',
          waitMs,
        );
      }
      incrementCounter('openai_rate_wait_total');
      await this.sleep(waitMs);
    }
  }

  private reconcile(reserved: number, actual: number): void {
    const now = this.now();
    refill(this.modelBucket, now);
    const delta = reserved - Math.max(0, actual);
    this.modelBucket.tokens = Math.max(
      0,
      Math.min(this.modelBucket.capacity, this.modelBucket.tokens + delta),
    );
  }

  private record429(error: unknown): number {
    this.consecutive429s += 1;
    incrementCounter('openai_rate_limited_total');
    const waitMs = retryAfterMs(error, this.now());
    if (this.consecutive429s >= this.options.circuit429Threshold) {
      this.circuitOpenUntil = Math.max(
        this.circuitOpenUntil,
        this.now() + Math.max(waitMs, this.options.circuitCooldownMs),
      );
      incrementCounter('openai_circuit_open_total');
    }
    return waitMs;
  }

  async execute<T>(request: OpenAIRequestOptions<T>): Promise<T> {
    let retries = 0;
    for (;;) {
      const reserved = await this.reserve(request.estimatedTokens, request.deadlineAt);
      try {
        const result = await request.operation();
        this.reconcile(reserved, request.usageTokens?.(result) ?? request.estimatedTokens);
        this.consecutive429s = 0;
        return result;
      } catch (error) {
        this.reconcile(reserved, 0);
        if (statusOf(error) !== 429) throw error;
        const waitMs = this.record429(error);
        const now = this.now();
        const availableMs = request.deadlineAt === undefined ? Infinity : request.deadlineAt - now;
        if (
          retries >= this.options.max429Retries ||
          waitMs > this.options.maxRateWaitMs ||
          waitMs > availableMs ||
          this.circuitOpenUntil > now
        ) {
          incrementCounter('openai_overload_rejected_total');
          throw new GatewayOverloadError(
            'provider_429',
            'OpenAI rate limit remained active after Retry-After',
            waitMs,
          );
        }
        retries += 1;
        incrementCounter('openai_retry_total');
        await this.sleep(waitMs);
      }
    }
  }

  snapshot(): OpenAIResilienceSnapshot {
    const now = this.now();
    refill(this.requestBucket, now);
    refill(this.modelBucket, now);
    return {
      rpmLimit: this.options.rpmLimit,
      tpmLimit: this.options.tpmLimit,
      requestTokens: Math.floor(this.requestBucket.tokens),
      modelTokens: Math.floor(this.modelBucket.tokens),
      consecutive429s: this.consecutive429s,
      circuitOpenUntil: this.circuitOpenUntil,
    };
  }
}

const controller = new OpenAIResilienceController({
  rpmLimit: config.openaiRpmLimit,
  tpmLimit: config.openaiTpmLimit,
  maxRateWaitMs: config.openaiRateWaitMaxMs,
  max429Retries: config.openai429RetryMax,
  circuit429Threshold: config.openaiCircuit429Threshold,
  circuitCooldownMs: config.openaiCircuitCooldownMs,
});

export function executeOpenAIRequest<T>(request: OpenAIRequestOptions<T>): Promise<T> {
  return controller.execute(request);
}

export function openAIResilienceSnapshot(): OpenAIResilienceSnapshot {
  return controller.snapshot();
}
