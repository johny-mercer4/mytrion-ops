/**
 * Verification pipeline provider (mock, no DB) + stage-status normalization. Pins: deterministic
 * per-client snapshots, a coherent decision (LOC always carries score+limit+cycle; undecided until
 * every stage resolves), the 9-stage business-ordered catalog, and the credit_platform status vocab
 * mapping the future live provider will reuse.
 */
import { describe, expect, it } from 'vitest';
import { mockPipelineProvider } from '../../src/modules/verificationPipeline/provider.js';
import { STAGE_CATALOG, normalizeStageStatus } from '../../src/modules/verificationPipeline/types.js';

describe('STAGE_CATALOG', () => {
  it('is the 9 business stages in order 1-9 with the credit_platform service ids', () => {
    expect(STAGE_CATALOG.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(STAGE_CATALOG.map((s) => s.id)).toEqual([
      'stop-factor-pre',
      'fmcsa',
      'plaid',
      'highway',
      'isoftpull',
      'blacklist',
      'antifraud',
      'crosscheck',
      'stop-factor-after',
    ]);
  });
});

describe('normalizeStageStatus', () => {
  it('maps the credit_platform vocab into the 5 UI states', () => {
    expect(normalizeStageStatus('OK')).toBe('done');
    expect(normalizeStageStatus('COMPLETED')).toBe('done');
    expect(normalizeStageStatus('FAILED')).toBe('failed');
    expect(normalizeStageStatus('UNAVAILABLE')).toBe('failed');
    expect(normalizeStageStatus('NOT_FOUND')).toBe('failed');
    expect(normalizeStageStatus('SKIPPED')).toBe('skipped');
    expect(normalizeStageStatus('PENDING')).toBe('pending');
    expect(normalizeStageStatus('')).toBe('not_started');
    expect(normalizeStageStatus(null)).toBe('not_started');
  });
});

describe('mockPipelineProvider', () => {
  it('returns null when no identity key is supplied', async () => {
    expect(await mockPipelineProvider.getPipeline({})).toBeNull();
    expect(await mockPipelineProvider.getPipeline({ dealId: '' })).toBeNull();
  });

  it('is deterministic per key', async () => {
    const a = await mockPipelineProvider.getPipeline({ dealId: 'D-123' });
    const b = await mockPipelineProvider.getPipeline({ dealId: 'D-123' });
    expect(a).toEqual(b);
    const c = await mockPipelineProvider.getPipeline({ dealId: 'D-999' });
    // Different key → (almost surely) a different snapshot; at least not forced-equal.
    expect(JSON.stringify(c)).not.toBe('null');
  });

  it('always returns the 9 ordered stages and a mock source', async () => {
    const snap = await mockPipelineProvider.getPipeline({ carrierId: '5817599' });
    expect(snap).not.toBeNull();
    expect(snap!.stages.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(snap!.source).toBe('mock');
  });

  it('decisions are coherent across many keys (LOC carries full terms; undecided ⇒ not all resolved)', async () => {
    for (let i = 0; i < 200; i++) {
      const snap = await mockPipelineProvider.getPipeline({ dealId: `deal-${i}` });
      expect(snap).not.toBeNull();
      const { stages, decision } = snap!;
      const allResolved = stages.every((s) => s.status !== 'not_started' && s.status !== 'pending');
      if (decision.outcome === 'undecided') {
        expect(allResolved).toBe(false); // undecided only while stages remain
      } else {
        expect(allResolved).toBe(true); // a final decision implies every stage resolved
      }
      if (decision.outcome === 'loc') {
        expect(typeof decision.creditScore).toBe('number');
        expect(typeof decision.approvedLimit).toBe('number');
        expect(decision.billingCycle).toBeTruthy();
      }
    }
  });
});
