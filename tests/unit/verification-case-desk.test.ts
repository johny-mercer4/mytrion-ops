import { describe, expect, it } from 'vitest';
import {
  buildCasesCsv,
  CASE_EXPORT_COLUMNS,
  caseSla,
  extractOfferFields,
  hostedPlaidLink,
  MANUAL_REVIEW_STALE_MINUTES,
  ownerMatchesViewer,
} from '../../src/modules/verification/verificationCaseDesk.js';

describe('verificationCaseDesk', () => {
  it('extracts payment / cycle / limit from manual review resolution', () => {
    expect(
      extractOfferFields({
        manual_review_resolution: {
          approved_limit: '15000',
          payment_type: 'LOC',
          billing_cycle: 'Weekly',
        },
      }),
    ).toEqual({ approvedLimit: '15000', paymentType: 'LOC', billingCycle: 'Weekly' });
  });

  it('keeps only the hosted Plaid URL', () => {
    expect(hostedPlaidLink('https://cdn.plaid.com/link/v2/stable/link.html?token=x')).toContain(
      'plaid.com',
    );
    expect(hostedPlaidLink('https://cp.example/api/v1/plaid/link/abc')).toBeNull();
    expect(hostedPlaidLink('')).toBeNull();
  });

  it('copies the desk stale threshold: claimed and idle ≥ 30 minutes', () => {
    expect(MANUAL_REVIEW_STALE_MINUTES).toBe(30);
    const now = new Date('2026-08-14T18:00:00.000Z');
    expect(
      caseSla({
        cpOwnerUsername: 'ada',
        cpReviewUpdatedAt: new Date('2026-08-14T17:29:00.000Z'),
        now,
      }).stale,
    ).toBe(true);
    expect(
      caseSla({
        cpOwnerUsername: 'ada',
        cpReviewUpdatedAt: new Date('2026-08-14T17:40:00.000Z'),
        now,
      }).stale,
    ).toBe(false);
    expect(caseSla({ cpOwnerUsername: null, now }).stale).toBe(false);
    expect(caseSla({ cpOwnerUsername: null, now }).label).toBe('Unclaimed');
  });

  it('matches queue owner to the viewer, case-insensitive', () => {
    expect(ownerMatchesViewer('Ada', 'ada')).toBe(true);
    expect(ownerMatchesViewer('ada', 'sam')).toBe(false);
    expect(ownerMatchesViewer(null, 'ada')).toBe(false);
  });

  it('exports the desk columns', () => {
    const csv = buildCasesCsv([
      {
        companyName: 'Acme, Inc',
        zohoApplicationId: 'APP-1',
        zohoDealId: 'DEAL-1',
        dot: '123',
        status: 'new',
        distributeType: 'shared',
        cpOwnerUsername: null,
        ownerName: 'Sarvar',
        approvedLimit: '10k',
        paymentType: 'LOC',
        billingCycle: 'Weekly',
      },
    ]);
    expect(csv.split('\n')[0]).toBe(CASE_EXPORT_COLUMNS.join(','));
    expect(csv).toContain('"Acme, Inc"');
    expect(csv).toContain('APP-1');
    expect(csv).toContain('Shared');
    expect(csv).toContain('Sarvar');
    expect(csv).toContain('LOC');
  });
});
