import { describe, expect, it } from 'vitest';
import {
  canonicalWebhookJson,
  expectedTaskWebhookSignature,
  verifyTaskWebhookSignature,
  webhookPayloadHash,
} from '../../src/modules/kpi/taskWebhookAuth.js';

describe('worker-task webhook authentication', () => {
  const body = {
    subject: 'Follow up',
    content: { z: 1, nested: { b: true, a: 'safe' } },
    assigneeZohoUserId: '42',
  };

  it('canonicalizes nested keys and hashes retries identically', () => {
    const reordered = {
      assigneeZohoUserId: '42',
      content: { nested: { a: 'safe', b: true }, z: 1 },
      subject: 'Follow up',
    };
    expect(canonicalWebhookJson(body)).toBe(canonicalWebhookJson(reordered));
    expect(webhookPayloadHash(body)).toBe(webhookPayloadHash(reordered));
  });

  it('accepts a valid timestamped HMAC with or without the sha256 prefix', () => {
    const timestamp = '1785200000';
    const signature = expectedTaskWebhookSignature('secret', timestamp, body);
    const input = {
      secret: 'secret',
      timestampSeconds: timestamp,
      body,
      nowMs: 1_785_200_000_000,
    };
    expect(verifyTaskWebhookSignature({ ...input, signature })).toBe(true);
    expect(verifyTaskWebhookSignature({ ...input, signature: `sha256=${signature}` })).toBe(true);
  });

  it('rejects tampering, malformed signatures and timestamps outside the replay window', () => {
    const timestamp = '1785200000';
    const signature = expectedTaskWebhookSignature('secret', timestamp, body);
    expect(
      verifyTaskWebhookSignature({
        secret: 'secret',
        timestampSeconds: timestamp,
        signature,
        body: { ...body, subject: 'Changed' },
        nowMs: 1_785_200_000_000,
      }),
    ).toBe(false);
    expect(
      verifyTaskWebhookSignature({
        secret: 'secret',
        timestampSeconds: timestamp,
        signature: 'not-a-signature',
        body,
        nowMs: 1_785_200_000_000,
      }),
    ).toBe(false);
    expect(
      verifyTaskWebhookSignature({
        secret: 'secret',
        timestampSeconds: timestamp,
        signature,
        body,
        nowMs: 1_785_200_301_000,
      }),
    ).toBe(false);
  });
});
