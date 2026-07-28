import { describe, expect, it } from 'vitest';
import {
  filterCaption,
  hasAnalyticsFilters,
  normalizeFilters,
  ownedCarrierCte,
  ownedCarrierCteBilling,
  ownedCarrierCteFor,
  pipelineOwnerPred,
  SqlParams,
  zohoIdSuffix,
} from '../../src/modules/analytics/filters.js';
import {
  ANALYTICS_DIMENSIONS,
  isAnalyticsDimension,
} from '../../src/modules/analytics/types.js';

describe('analytics filters', () => {
  it('normalizeFilters defaults range to this_month', () => {
    expect(normalizeFilters(null).range).toBe('this_month');
    expect(normalizeFilters({ range: 'today' }).range).toBe('today');
  });

  it('hasAnalyticsFilters is false for default org MTD', () => {
    expect(hasAnalyticsFilters({})).toBe(false);
    expect(hasAnalyticsFilters({ range: 'this_month' })).toBe(false);
  });

  it('hasAnalyticsFilters is true for agent or non-default date', () => {
    expect(hasAnalyticsFilters({ agentName: 'Daniel Brown' })).toBe(true);
    expect(hasAnalyticsFilters({ agentId: '123456789012' })).toBe(true);
    expect(hasAnalyticsFilters({ range: 'this_week' })).toBe(true);
  });

  it('zohoIdSuffix keeps last 12 digits', () => {
    expect(zohoIdSuffix('zoho:000123456789012')).toBe('123456789012');
    expect(zohoIdSuffix('abc')).toBe('');
  });

  it('pipelineOwnerPred binds id-suffix preferentially', () => {
    const p = new SqlParams();
    const pred = pipelineOwnerPred('zu', { agentId: '999123456789012', agentName: 'Other' }, p);
    expect(pred).toContain("lpad(right(zu.id::text, 12), 12, '0')");
    expect(pred).toContain('$1');
    expect(p.values).toEqual(['123456789012']);
  });

  it('pipelineOwnerPred falls back to name', () => {
    const p = new SqlParams();
    const pred = pipelineOwnerPred('zu', { agentName: 'Daniel Brown' }, p);
    expect(pred).toContain('lower(zu.full_name) = lower($1)');
    expect(p.values).toEqual(['Daniel Brown']);
  });

  it('filterCaption summarises agent + range', () => {
    expect(filterCaption({ agentName: 'Daniel Brown', range: 'this_week' })).toBe(
      'agent: Daniel Brown · this week',
    );
  });
});

describe('ownedCarrierCteFor', () => {
  it('is inert without an agent filter — callers must not join', () => {
    const p = new SqlParams();
    expect(ownedCarrierCteFor('i', { range: 'this_month' }, p)).toEqual({ cte: '', joinOn: '' });
    expect(p.values).toEqual([]);
  });

  it('joins on the caller-supplied alias', () => {
    const forInvoice = ownedCarrierCteFor('i', { agentName: 'Daniel Brown' }, new SqlParams());
    expect(forInvoice.joinOn).toBe('join owned o on o.carrier_id = i.carrier_id');
    const forPayments = ownedCarrierCteFor('bh', { agentName: 'Daniel Brown' }, new SqlParams());
    expect(forPayments.joinOn).toBe('join owned o on o.carrier_id = bh.carrier_id');
  });

  it('keeps the preset alias wrappers on the same owner authority', () => {
    expect(ownedCarrierCte({ agentName: 'A' }, new SqlParams()).joinOn).toBe(
      'join owned o on o.carrier_id = t.carrier_id',
    );
    expect(ownedCarrierCteBilling({ agentName: 'A' }, new SqlParams()).joinOn).toBe(
      'join owned o on o.carrier_id = bh.carrier_id',
    );
  });

  it('binds the owner values rather than concatenating them', () => {
    const p = new SqlParams();
    const { cte } = ownedCarrierCteFor('i', { agentId: '999123456789012', agentName: 'Daniel Brown' }, p);
    expect(p.values).toEqual(['123456789012', 'Daniel Brown']);
    expect(cte).toContain('$1');
    expect(cte).toContain('$2');
    expect(cte).not.toContain('Daniel Brown');
  });
});

describe('analytics dimensions', () => {
  it('registers Customer Service and Finance as their own dimensions', () => {
    // Regression: CS used to render `pipeline` and Finance `billing`, so four sidebar
    // categories showed only two distinct dashboards.
    expect(isAnalyticsDimension('support')).toBe(true);
    expect(isAnalyticsDimension('receivables')).toBe(true);
    expect(ANALYTICS_DIMENSIONS).toHaveLength(new Set(ANALYTICS_DIMENSIONS).size);
  });

  it('keeps the Sales scorecard and the CRM deal funnel as separate dimensions', () => {
    // Sales used to render `pipeline` (the deal funnel), which is the Power BI report's CRM page.
    // Sales is now the card/volume scorecard; the funnel stayed on `pipeline` under CRM.
    expect(isAnalyticsDimension('sales')).toBe(true);
    expect(isAnalyticsDimension('pipeline')).toBe(true);
  });

  it('rejects unknown dimensions', () => {
    expect(isAnalyticsDimension('customer-service')).toBe(false);
    expect(isAnalyticsDimension('crm')).toBe(false);
    expect(isAnalyticsDimension('')).toBe(false);
  });
});
