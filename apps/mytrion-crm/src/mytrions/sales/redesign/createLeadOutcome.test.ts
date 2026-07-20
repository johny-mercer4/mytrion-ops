import { describe, expect, it } from 'vitest';
import { extractDuplicateLeadId, resolveCreateLeadOutcome } from './createLeadOutcome';

describe('extractDuplicateLeadId', () => {
  it('reads details.id from a DUPLICATE_DATA object', () => {
    expect(extractDuplicateLeadId({ code: 'DUPLICATE_DATA', details: { id: '999' } })).toBe('999');
  });

  it('parses a JSON-string response', () => {
    expect(
      extractDuplicateLeadId(JSON.stringify({ code: 'DUPLICATE_DATA', details: { id: '888' } })),
    ).toBe('888');
  });

  it('walks Zoho data[] envelopes', () => {
    expect(
      extractDuplicateLeadId({
        data: [{ code: 'DUPLICATE_DATA', details: { id: '777' } }],
      }),
    ).toBe('777');
  });
});

describe('resolveCreateLeadOutcome', () => {
  it('returns created on success + leadId', () => {
    expect(resolveCreateLeadOutcome({ success: true, leadId: '111' })).toEqual({
      ok: true,
      duplicate: false,
      leadId: '111',
      message: '',
    });
  });

  it('accepts string success flags from Deluge', () => {
    expect(resolveCreateLeadOutcome({ success: 'true', leadId: '222' })).toMatchObject({
      ok: true,
      duplicate: false,
      leadId: '222',
    });
  });

  it('extracts DUPLICATE_DATA id from nested response object', () => {
    expect(
      resolveCreateLeadOutcome({
        success: false,
        message: 'duplicate',
        response: { code: 'DUPLICATE_DATA', details: { id: '999' } },
      }),
    ).toEqual({
      ok: true,
      duplicate: true,
      leadId: '999',
      message: 'duplicate',
    });
  });

  it('extracts DUPLICATE_DATA id from JSON string response', () => {
    expect(
      resolveCreateLeadOutcome({
        success: false,
        response: JSON.stringify({ code: 'DUPLICATE_DATA', details: { id: '888' } }),
      }),
    ).toMatchObject({ ok: true, duplicate: true, leadId: '888' });
  });

  it('does not treat a bare failure leadId as a duplicate', () => {
    expect(
      resolveCreateLeadOutcome({ success: false, leadId: '123', message: 'rejected' }),
    ).toEqual({
      ok: false,
      duplicate: false,
      leadId: '',
      message: 'rejected',
    });
  });

  it('fails when success is false and no id is recoverable', () => {
    expect(resolveCreateLeadOutcome({ success: false, message: 'nope' })).toEqual({
      ok: false,
      duplicate: false,
      leadId: '',
      message: 'nope',
    });
  });
});
