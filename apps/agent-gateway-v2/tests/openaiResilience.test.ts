import { describe, expect, it } from 'vitest';
import { OpenAIResilienceController, retryAfterMs } from '../src/openaiResilience.js';
import { GatewayOverloadError } from '../src/overload.js';

function controller(
  overrides: Partial<ConstructorParameters<typeof OpenAIResilienceController>[0]> = {},
): {
  value: OpenAIResilienceController;
  sleeps: number[];
  advance: (ms: number) => void;
} {
  let now = 10_000;
  const sleeps: number[] = [];
  return {
    value: new OpenAIResilienceController({
      rpmLimit: 60,
      tpmLimit: 100_000,
      maxRateWaitMs: 30_000,
      max429Retries: 1,
      circuit429Threshold: 3,
      circuitCooldownMs: 30_000,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      ...overrides,
    }),
    sleeps,
    advance: (ms) => {
      now += ms;
    },
  };
}

describe('OpenAI provider resilience', () => {
  it('honors Retry-After before retrying a 429', async () => {
    const harness = controller();
    let calls = 0;
    const result = await harness.value.execute({
      estimatedTokens: 100,
      operation: async () => {
        calls += 1;
        if (calls === 1) {
          throw { status: 429, headers: { 'retry-after': '2' } };
        }
        return { usage: 80, value: 'ok' };
      },
      usageTokens: (response) => response.usage,
    });

    expect(result.value).toBe('ok');
    expect(calls).toBe(2);
    expect(harness.sleeps).toContain(2_000);
  });

  it('opens the circuit after consecutive 429s and skips the API call', async () => {
    const harness = controller({
      max429Retries: 0,
      circuit429Threshold: 2,
    });
    let calls = 0;
    const fail = async (): Promise<void> => {
      calls += 1;
      throw { status: 429, headers: { 'retry-after': '1' } };
    };

    await expect(
      harness.value.execute({ estimatedTokens: 10, operation: fail }),
    ).rejects.toMatchObject({ kind: 'provider_429' });
    await expect(
      harness.value.execute({ estimatedTokens: 10, operation: fail }),
    ).rejects.toMatchObject({ kind: 'provider_429' });
    await expect(
      harness.value.execute({ estimatedTokens: 10, operation: fail }),
    ).rejects.toBeInstanceOf(GatewayOverloadError);
    expect(calls).toBe(2);
    expect(harness.value.snapshot().circuitOpenUntil).toBeGreaterThan(10_000);
  });

  it('rejects instead of waiting past a request deadline', async () => {
    const harness = controller({ rpmLimit: 1 });
    await harness.value.execute({
      estimatedTokens: 10,
      operation: async () => 'first',
    });
    let called = false;
    await expect(
      harness.value.execute({
        estimatedTokens: 10,
        deadlineAt: 10_500,
        operation: async () => {
          called = true;
          return 'second';
        },
      }),
    ).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(called).toBe(false);
  });

  it('parses seconds, milliseconds, and HTTP-date retry headers', () => {
    expect(retryAfterMs({ headers: { 'retry-after': '1.5' } }, 0)).toBe(1_500);
    expect(retryAfterMs({ headers: { 'retry-after-ms': '250' } }, 0)).toBe(250);
    expect(
      retryAfterMs({ headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:02 GMT' } }, 1_000),
    ).toBe(1_000);
  });
});
