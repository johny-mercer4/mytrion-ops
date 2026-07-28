import { createHash, createHmac } from 'node:crypto';
import { safeEqual } from '../../lib/crypto.js';

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

/** Stable JSON so callers do not need access to Fastify's raw request bytes. */
export function canonicalWebhookJson(body: unknown): string {
  return JSON.stringify(canonicalValue(body));
}

export function webhookPayloadHash(body: unknown): string {
  return createHash('sha256').update(canonicalWebhookJson(body)).digest('hex');
}

export function expectedTaskWebhookSignature(
  secret: string,
  timestampSeconds: string,
  body: unknown,
): string {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${canonicalWebhookJson(body)}`)
    .digest('hex');
}

export function verifyTaskWebhookSignature(input: {
  secret: string;
  timestampSeconds: string;
  signature: string;
  body: unknown;
  nowMs?: number;
  toleranceSeconds?: number;
}): boolean {
  const timestamp = Number(input.timestampSeconds);
  if (!Number.isInteger(timestamp)) return false;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > (input.toleranceSeconds ?? 300)) return false;
  const actual = input.signature.startsWith('sha256=')
    ? input.signature.slice('sha256='.length)
    : input.signature;
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  return safeEqual(
    actual.toLowerCase(),
    expectedTaskWebhookSignature(input.secret, input.timestampSeconds, input.body),
  );
}
