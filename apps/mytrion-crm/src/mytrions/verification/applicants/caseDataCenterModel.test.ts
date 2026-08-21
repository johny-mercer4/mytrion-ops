import { describe, expect, it } from 'vitest';
import type { FmcsaCarrierRow, FmcsaSearchResult } from '@/api/verificationFmcsa';
import {
  fmcsaAddress,
  fmcsaCarrierTitle,
  fmcsaDetailFacts,
  fmcsaPrefill,
  fmcsaPrefillFromSearch,
  fmcsaRows,
  flattenFields,
  motusPrefill,
  blacklistPrefill,
  brokerPrefill,
  brokerSnapshotTitle,
} from './caseDataCenterModel';

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

  it('reads workspace query params without requiring a case', () => {
    expect(fmcsaPrefillFromSearch('?tab=data-center&dot=987654&mc=123456')).toEqual({
      dot: '987654',
      mc: '123456',
      companyName: null,
      email: null,
      phone: null,
    });
    expect(fmcsaPrefill(fmcsaPrefillFromSearch('?name=Ridgevale%20Freight'))).toEqual({
      by: 'name',
      q: 'Ridgevale Freight',
    });
    expect(fmcsaPrefill(fmcsaPrefillFromSearch('?q=Ridgevale'))).toEqual({
      by: 'name',
      q: 'Ridgevale',
    });
    expect(fmcsaPrefill(fmcsaPrefillFromSearch(''))).toEqual({ by: 'dot', q: '' });
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

describe('motusPrefill', () => {
  it('uses USDOT or name, never MC', () => {
    expect(motusPrefill({ dot: '652739', mc: '307348', companyName: 'Stone' })).toEqual({
      by: 'dot',
      q: '652739',
    });
    expect(motusPrefill({ mc: '307348', companyName: 'Stone Express' })).toEqual({
      by: 'name',
      q: 'Stone Express',
    });
    expect(motusPrefill({ mc: '307348' })).toEqual({ by: 'dot', q: '' });
  });
});

describe('brokerPrefill', () => {
  it('uses USDOT or the person name, never MC', () => {
    expect(brokerPrefill({ dot: '8844425', mc: '307348', companyName: 'Stone', firstName: 'Ada', lastName: 'Cole' })).toEqual({
      by: 'dot',
      q: '8844425',
    });
    expect(brokerPrefill({ mc: '307348', firstName: 'Ada', lastName: 'Cole', companyName: 'Stone Express' })).toEqual({
      by: 'name',
      q: 'Ada Cole',
    });
    expect(brokerPrefill({ mc: '307348', companyName: 'Stone Express' })).toEqual({
      by: 'name',
      q: 'Stone Express',
    });
    expect(brokerPrefill({ mc: '307348' })).toEqual({ by: 'dot', q: '' });
  });

  it('names the owner, not a missing legal name', () => {
    expect(brokerSnapshotTitle({
      id: '1',
      dotNumber: '8844425',
      ownerFullName: 'Abdirehin Ahmed',
      phoneNumber: null,
      email: null,
      physicalAddress: null,
      operatingStatus: null,
      powerUnits: null,
      truckSize: null,
      addDate: null,
      changeDate: null,
      isActive: true,
    })).toBe('Abdirehin Ahmed');
  });
});

describe('blacklistPrefill', () => {
  it('prefers USDOT, then MC, email, phone, then name', () => {
    expect(blacklistPrefill({
      dot: '987654',
      mc: '123456',
      email: 'ops@kaiser.test',
      phone: '6145550110',
      companyName: 'Ridgevale',
    })).toEqual({ by: 'dot', q: '987654' });
    expect(blacklistPrefill({ mc: '123456', email: 'ops@kaiser.test' })).toEqual({
      by: 'mc',
      q: '123456',
    });
    expect(blacklistPrefill({ email: 'ops@kaiser.test', phone: '6145550110' })).toEqual({
      by: 'email',
      q: 'ops@kaiser.test',
    });
    expect(blacklistPrefill({ phone: '6145550110', companyName: 'Ridgevale' })).toEqual({
      by: 'phone',
      q: '6145550110',
    });
    expect(blacklistPrefill({ companyName: 'Ridgevale Freight' })).toEqual({
      by: 'name',
      q: 'Ridgevale Freight',
    });
  });

  it('reads email and phone from the workspace query', () => {
    expect(blacklistPrefill(fmcsaPrefillFromSearch('?email=ops%40kaiser.test'))).toEqual({
      by: 'email',
      q: 'ops@kaiser.test',
    });
    expect(blacklistPrefill(fmcsaPrefillFromSearch('?phone=6145550110'))).toEqual({
      by: 'phone',
      q: '6145550110',
    });
  });
});

describe('flattenFields', () => {
  it('keeps an extra key and skips nulls already shown in the row', () => {
    expect(
      flattenFields({ legalName: 'Ridgevale', totalPowerUnits: 12, phyCountry: null }, ['legalName']),
    ).toEqual([{ label: 'totalPowerUnits', value: '12' }]);
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
    expect(fmcsaDetailFacts(row({ fields: { totalPowerUnits: 4, legalName: 'X' } }))).toEqual([
      { label: 'totalPowerUnits', value: '4' },
    ]);
  });
});
