import { describe, expect, it } from 'vitest';
import { resolveCreateLeadOutcome } from './createLeadOutcome';

describe('resolveCreateLeadOutcome', () => {
  it('returns created on success + leadId', () => {
    expect(resolveCreateLeadOutcome({ success: true, leadId: '111' })).toEqual({
      ok: true,
      duplicate: false,
      leadId: '111',
      message: '',
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

  it('fails when success is false and no id is recoverable', () => {
    expect(resolveCreateLeadOutcome({ success: false, message: 'nope' })).toEqual({
      ok: false,
      duplicate: false,
      leadId: '',
      message: 'nope',
    });
  });
});
