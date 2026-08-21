import { describe, expect, it } from 'vitest';
import type { FmcsaCarrierRow, FmcsaSearchResult } from '@/api/verificationFmcsa';
import { fmcsaAddress, fmcsaCarrierTitle, fmcsaPrefill, fmcsaRows } from './caseDataCenterModel';

function row(over: Partial<FmcsaCarrierRow> = {}): FmcsaCarrierRow {
  return {
    status: 'active',
    allowedToOperate: 'yes',
    authority: {
      common: { raw: 'A', verdict: 'active' },
      contract: { raw: 'N', verdict: 'none' },
      broker: { raw: 'N', verdict: 'none' },
    },
    insurance: {
      bipd: { raw: '1000', dollars: 1_000_000, onFile: true, required: 'yes', requiredDollars: 750_000 },
      bond: { raw: '0', dollars: 0, onFile: false, required: 'unknown', requiredDollars: null },
      cargo: { raw: '0', dollars: 0, onFile: false, required: 'unknown', requiredDollars: null },
    },
    ...over,
  };
}

function result(over: Partial<FmcsaSearchResult> = {}): FmcsaSearchResult {
  return {
    available: true,
    error: null,
    reason: null,
    matchedOn: 'dot',
    carrier: null,
    candidates: [],
    candidatesTruncated: false,
    notFound: false,
    retrievalDate: null,
    ...over,
  };
}

describe('fmcsaPrefill', () => {
  it('prefers USDOT, then MC, then legal name', () => {
    expect(fmcsaPrefill({ dot: '987654', mc: '123456', companyName: 'Ridgevale' })).toEqual({
      by: 'dot',
      q: '987654',
    });
    expect(fmcsaPrefill({ dot: '  ', mc: 'MC-12', companyName: 'Ridgevale' })).toEqual({
      by: 'mc',
      q: 'MC-12',
    });
    expect(fmcsaPrefill({ companyName: 'Ridgevale Freight' })).toEqual({
      by: 'name',
      q: 'Ridgevale Freight',
    });
  });

  it('falls back to the person name, then an empty USDOT box', () => {
    expect(fmcsaPrefill({ firstName: 'Ada', lastName: 'Cole' })).toEqual({
      by: 'name',
      q: 'Ada Cole',
    });
    expect(fmcsaPrefill({})).toEqual({ by: 'dot', q: '' });
  });
});

describe('fmcsaRows', () => {
  it('dedupes the hit against candidates on USDOT', () => {
    const hit = row({ legalName: 'Ridgevale Freight', dotNumber: '987654' });
    const rows = fmcsaRows(
      result({
        carrier: hit,
        candidates: [hit, row({ legalName: 'Ridgevale Logistics', dotNumber: '111111' })],
      }),
    );
    expect(rows.map((item) => item.dotNumber)).toEqual(['987654', '111111']);
  });
});

describe('fmcsa labels', () => {
  it('joins a physical address and names the carrier', () => {
    const hit = row({
      legalName: 'Ridgevale Freight',
      phyStreet: '100 Dock Rd',
      phyCity: 'Chicago',
      phyState: 'IL',
      phyZipcode: '60601',
    });
    expect(fmcsaAddress(hit)).toBe('100 Dock Rd · Chicago, IL · 60601');
    expect(fmcsaCarrierTitle(row({}))).toBe('Unnamed carrier');
  });
});
