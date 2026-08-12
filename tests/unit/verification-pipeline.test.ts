/**
 * Verification pipeline fallback + shared normalization/requirement parsing. Pins deterministic
 * development snapshots, coherent decisions, the business-ordered stage catalog, credit_platform
 * status normalization, and the payload-driven Sales action contract used by the live provider.
 */
import { describe, expect, it } from 'vitest';
import { mockPipelineProvider } from '../../src/modules/verificationPipeline/provider.js';
import { extractSalesRequirements } from '../../src/modules/verificationPipeline/requirements.js';
import { STAGE_CATALOG, deriveZohoState, normalizeStageStatus } from '../../src/modules/verificationPipeline/types.js';

describe('STAGE_CATALOG', () => {
  it('is the compliance stages in credit_platform order with the credit_platform service ids', () => {
    expect(STAGE_CATALOG.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(STAGE_CATALOG.map((s) => s.id)).toEqual([
      'stop-factor-pre',
      'blacklist',
      'fmcsa',
      'plaid',
      'highway',
      'creditsafe',
      'isoftpull',
      'antifraud',
      'crosscheck',
      'stop-factor-after',
    ]);
  });
});

describe('deriveZohoState', () => {
  it('maps Zoho credit into a filter bucket without treating "prepay" alone as rejected', () => {
    expect(
      deriveZohoState({
        creditDecision: 'Declined-Prepay/Secured Only',
        applicationStatus: 'Pending Decision',
        applicationId: '899640',
      }),
    ).toBe('rejected');
    expect(
      deriveZohoState({
        creditDecision: 'Approved-Requested',
        applicationStatus: 'Pending Setup',
        applicationId: '1',
      }),
    ).toBe('approved');
    expect(
      deriveZohoState({
        creditDecision: null,
        applicationStatus: 'Pending Decision',
        applicationId: '899640',
      }),
    ).toBe('in_progress');
    expect(
      deriveZohoState({
        creditDecision: 'Prepay',
        applicationStatus: 'Pending Decision',
        applicationId: '899640',
      }),
    ).toBe('in_progress');
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

  it('always returns the ordered stages and a mock source', async () => {
    const snap = await mockPipelineProvider.getPipeline({ carrierId: '5817599' });
    expect(snap).not.toBeNull();
    expect(snap!.stages.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
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

describe('extractSalesRequirements', () => {
  it('turns an MC/DOT-needed event into a required red-flag form', () => {
    const result = extractSalesRequirements([
      {
        id: 41,
        status: 'NEEDS_INPUT',
        title: 'MC DOT needed from Sales',
        payload: { audience: 'sales', message: 'Please confirm both identifiers.' },
        createdAt: '2026-08-01T10:00:00.000Z',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.fields.map((field) => field.id)).toEqual(['mc_number', 'dot_number']);
    expect(result[0]?.detail).toBe('Please confirm both identifiers.');
  });

  it('uses payload-defined fields, choices, and attachment requirements', () => {
    const result = extractSalesRequirements([
      {
        id: 'evt-2',
        status: 'ACTION_REQUIRED',
        title: 'Insurance document required',
        payload: {
          target_department: 'sales',
          required_fields: [
            { key: 'policy_number', label: 'Policy number', type: 'text' },
            { key: 'coverage', type: 'select', options: ['Primary', 'Excess'] },
          ],
          attachment_required: true,
        },
        createdAt: '2026-08-01T10:00:00.000Z',
      },
    ]);
    expect(result[0]?.attachmentRequired).toBe(true);
    expect(result[0]?.fields[1]).toMatchObject({ id: 'coverage', type: 'select' });
  });

  it('ignores ordinary pipeline events and requests for another department', () => {
    expect(
      extractSalesRequirements([
        {
          id: 1,
          status: 'SUBMITTED',
          title: 'External applicant creation requested',
          payload: {},
          createdAt: '',
        },
        {
          id: 2,
          status: 'ACTION_REQUIRED',
          title: 'Review required',
          payload: { audience: 'verification', fields: ['answer'] },
          createdAt: '',
        },
      ]),
    ).toEqual([]);
  });
});
