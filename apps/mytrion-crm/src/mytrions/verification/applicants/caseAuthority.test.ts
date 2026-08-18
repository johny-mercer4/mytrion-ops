import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_CHECKS,
  authorityCanPass,
  authorityChecklistLines,
  missingAuthorityDocs,
} from './caseAuthority';

describe('authorityCanPass', () => {
  it('requires every authority check OK and no structure still needed', () => {
    expect(authorityCanPass({ checks: {}, relatedCompany: null, thirdParty: null })).toBe(false);
    const checks = Object.fromEntries(AUTHORITY_CHECKS.map((c) => [c.id, 'ok' as const]));
    expect(authorityCanPass({ checks, relatedCompany: null, thirdParty: null })).toBe(true);
    expect(authorityCanPass({ checks, relatedCompany: 'needed', thirdParty: null })).toBe(false);
    expect(authorityCanPass({ checks, relatedCompany: 'na', thirdParty: 'ok' })).toBe(true);
    expect(
      authorityCanPass({
        checks: { ...checks, insurance: 'inactive' },
        relatedCompany: null,
        thirdParty: null,
      }),
    ).toBe(false);
  });
});

describe('missingAuthorityDocs', () => {
  it('maps missing checks and needed structure onto existing document types', () => {
    expect(
      missingAuthorityDocs({
        checks: { insurance: 'missing', mc: 'inactive' },
        relatedCompany: 'needed',
        thirdParty: 'needed',
      }),
    ).toEqual([
      { docType: 'insurance', label: 'Insurance certificate' },
      { docType: 'corporate_guarantee', label: 'Corporate guarantee' },
      { docType: 'lease_agreement', label: 'Lease agreement' },
      { docType: 'other', label: 'Unit information' },
    ]);
  });
});

describe('authorityChecklistLines', () => {
  it('lists the carrier SOP checks', () => {
    const lines = authorityChecklistLines();
    expect(lines).toContain('MC status');
    expect(lines).toContain('Related-company structure — Corporate Guarantee');
  });
});
