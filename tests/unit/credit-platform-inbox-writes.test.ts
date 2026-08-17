import { describe, expect, it, vi } from 'vitest';
import {
  assertPayloadPatch,
  assertRunStageId,
  InboxWhitelistError,
  pickPresentPatch,
  stampMytrionAgent,
} from '../../src/integrations/creditPlatformInboxWrites.js';

describe('stampMytrionAgent', () => {
  it('prefixes mytrion: once', () => {
    expect(stampMytrionAgent('sarvar')).toBe('mytrion:sarvar');
    expect(stampMytrionAgent('mytrion:system')).toBe('mytrion:system');
    expect(stampMytrionAgent('')).toBe('mytrion:system');
  });
});

describe('assertPayloadPatch', () => {
  it('accepts the whitelist and drops empties', () => {
    expect(
      assertPayloadPatch({
        dot_number: '1234567',
        mc_number: '  ',
        carrier_name: 'Acme',
        state: 'TX',
      }),
    ).toEqual({ dot_number: '1234567', carrier_name: 'Acme', state: 'TX' });
  });

  it('rejects unknown keys and never inserts applicant/ssn/status', () => {
    expect(() => assertPayloadPatch({ ssn: '111-22-3333' })).toThrow(InboxWhitelistError);
    expect(() => assertPayloadPatch({ applicant_profile: '{}' })).toThrow(InboxWhitelistError);
    expect(() => assertPayloadPatch({ status: 'REVIEW' })).toThrow(InboxWhitelistError);
    expect(() => assertPayloadPatch({ external_applicant_id: 'x' })).toThrow(InboxWhitelistError);
    expect(() => assertPayloadPatch({ email: 'a@b.c' })).toThrow(InboxWhitelistError);
    try {
      assertPayloadPatch({ ssn: '1', email: 'a@b.c' });
    } catch (err) {
      expect(err).toBeInstanceOf(InboxWhitelistError);
      expect((err as InboxWhitelistError).rejected).toEqual(['ssn']);
    }
  });
});

describe('assertRunStageId', () => {
  it('accepts the first-run trio', () => {
    expect(assertRunStageId('stop_factor_pre')).toBe('stop_factor_pre');
    expect(assertRunStageId('blacklist')).toBe('blacklist');
    expect(assertRunStageId('fmcsa')).toBe('fmcsa');
  });

  it('rejects billable stages and anything else', () => {
    for (const id of ['isoftpull', 'creditsafe', 'plaid_bs', 'highway', 'antifraud']) {
      expect(() => assertRunStageId(id)).toThrow(InboxWhitelistError);
    }
  });
});

describe('pickPresentPatch', () => {
  it('keeps only present whitelist fields', () => {
    expect(pickPresentPatch({ dotNumber: '99', carrierName: 'A' })).toEqual({
      dot_number: '99',
      carrier_name: 'A',
    });
  });
});

describe('insert helpers refuse before write', () => {
  it('does not call the write pool when the whitelist rejects', async () => {
    vi.resetModules();
    const writeQuery = vi.fn();
    vi.doMock('../../src/integrations/creditPlatformWriteDb.js', () => ({
      writeQuery,
      isWriteConfigured: () => true,
    }));
    const { insertPayloadPatch, insertRunStage } = await import(
      '../../src/integrations/creditPlatformInboxWrites.js'
    );
    await expect(
      insertPayloadPatch({ requestId: 'r1', agent: 'system', changes: { ssn: '1' } }),
    ).rejects.toMatchObject({ name: 'InboxWhitelistError', code: 'INBOX_WHITELIST_REJECTED' });
    await expect(
      insertRunStage({ requestId: 'r1', agent: 'system', stageId: 'isoftpull' }),
    ).rejects.toMatchObject({ name: 'InboxWhitelistError', code: 'INBOX_WHITELIST_REJECTED' });
    expect(writeQuery).not.toHaveBeenCalled();
  });
});
