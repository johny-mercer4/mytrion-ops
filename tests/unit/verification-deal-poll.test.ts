/**
 * The poll loop: how it avoids duplicates, and who it tells.
 *
 * The cursor rests on a DATE, so every run re-reads at least one whole day of applications. That
 * makes the duplicate handling load-bearing rather than defensive — without it the job would either
 * re-create applications or spend a round trip per already-known deal before doing any work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const runCoql = vi.fn();
const getRecord = vi.fn();
const findExistingDealIds = vi.fn();
const createApplicationFromDeal = vi.fn();
const createInboxMessage = vi.fn();
const matchBrokerSnapshot = vi.fn();
const saveRun = vi.fn();

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: { runCoql: (...a: unknown[]) => runCoql(...a) },
}));
vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: { getRecord: (...a: unknown[]) => getRecord(...a) },
}));
vi.mock('../../src/repos/verificationCaseRepo.js', () => ({
  verificationCaseRepo: {
    findExistingDealIds: (...a: unknown[]) => findExistingDealIds(...a),
    update: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../src/repos/verificationIngestStateRepo.js', () => ({
  verificationIngestStateRepo: {
    getOrCreate: vi.fn().mockResolvedValue({ pollDealDateWatermark: '2026-08-14' }),
    pinWatermark: vi.fn().mockResolvedValue(undefined),
    saveRun: (...a: unknown[]) => saveRun(...a),
  },
}));
vi.mock('../../src/modules/verificationFlow/dealIntake.js', () => ({
  createApplicationFromDeal: (...a: unknown[]) => createApplicationFromDeal(...a),
}));
vi.mock('../../src/modules/inbox/service.js', () => ({
  createInboxMessage: (...a: unknown[]) => createInboxMessage(...a),
}));
vi.mock('../../src/modules/verification/carrierEnrich.js', () => ({
  matchBrokerSnapshot: (...a: unknown[]) => matchBrokerSnapshot(...a),
}));
vi.mock('../../src/modules/verification/verificationOwner.js', () => ({
  VERIFICATION_CASE_OWNER_NAME: 'Verification',
  resolveVerificationCaseOwnerId: vi.fn().mockResolvedValue('9001'),
}));

const { ingestVerificationDeals } = await import('../../src/modules/verification/zohoDealIngest.js');

const ctx = { tenantId: DEFAULT_TENANT_ID, userId: 'system', audience: 'internal', role: 'admin' } as TenantContext;

const dealRow = (id: string, date = '2026-08-15') => ({ id, Application_Date: date });

beforeEach(() => {
  runCoql.mockReset();
  getRecord.mockReset().mockImplementation((_m: string, id: string) =>
    Promise.resolve({ id, Deal_Name: `Co ${id}`, Application_Date: '2026-08-15', Owner: { id: '42', name: 'Dana' } }),
  );
  findExistingDealIds.mockReset().mockResolvedValue(new Set());
  createApplicationFromDeal.mockReset().mockImplementation(() => Promise.resolve({ id: `vc_${Math.random()}` }));
  createInboxMessage.mockReset().mockResolvedValue({});
  matchBrokerSnapshot.mockReset().mockResolvedValue(null);
  saveRun.mockReset().mockResolvedValue(undefined);
});

describe('duplicate handling', () => {
  it('checks every candidate in ONE query, not one per deal', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('1'), dealRow('2'), dealRow('3')] });
    await ingestVerificationDeals(ctx);
    expect(findExistingDealIds).toHaveBeenCalledTimes(1);
    expect(findExistingDealIds.mock.calls[0]?.[1]).toEqual(['1', '2', '3']);
  });

  it('never fetches the Zoho record for a deal it already has', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('1'), dealRow('2')] });
    findExistingDealIds.mockResolvedValue(new Set(['1']));
    const res = await ingestVerificationDeals(ctx);
    expect(getRecord).toHaveBeenCalledTimes(1);
    expect(getRecord).toHaveBeenCalledWith('Deals', '2');
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it('costs a single query and no record fetches when the whole page is known', async () => {
    // The steady state: the cursor day re-read, everything on it already ingested.
    runCoql.mockResolvedValue({ rows: [dealRow('1'), dealRow('2'), dealRow('3')] });
    findExistingDealIds.mockResolvedValue(new Set(['1', '2', '3']));
    const res = await ingestVerificationDeals(ctx);
    expect(getRecord).not.toHaveBeenCalled();
    expect(createApplicationFromDeal).not.toHaveBeenCalled();
    expect(res).toMatchObject({ created: 0, skipped: 3 });
  });

  it('collapses a deal returned twice in the same page', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('7'), dealRow('7')] });
    await ingestVerificationDeals(ctx);
    expect(findExistingDealIds.mock.calls[0]?.[1]).toEqual(['7']);
    expect(createApplicationFromDeal).toHaveBeenCalledTimes(1);
  });

  it('drops a deal whose application date is behind the cursor', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('1', '2026-08-13'), dealRow('2', '2026-08-15')] });
    const res = await ingestVerificationDeals(ctx);
    expect(findExistingDealIds.mock.calls[0]?.[1]).toEqual(['2']);
    expect(res.skipped).toBe(1);
  });
});

describe('the watermark', () => {
  it('advances to the furthest application date seen', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('1', '2026-08-15'), dealRow('2', '2026-08-18')] });
    const res = await ingestVerificationDeals(ctx);
    expect(res.watermark).toBe('2026-08-18');
  });

  it('does not advance while anything failed, so nothing is skipped past', async () => {
    runCoql.mockResolvedValue({ rows: [{ id: 'not-numeric' }, dealRow('2', '2026-08-18')] });
    const res = await ingestVerificationDeals(ctx);
    expect(res.failed).toBe(1);
    expect(res.watermark).toBe('2026-08-14');
  });
});

describe('who gets told', () => {
  it('posts to BOTH the Deal owner and the Verification agent', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('1')] });
    createApplicationFromDeal.mockResolvedValue({ id: 'vc_1' });
    await ingestVerificationDeals(ctx);

    const owners = createInboxMessage.mock.calls.map(
      (c) => (c[1] as { ownerZohoUserId: string }).ownerZohoUserId,
    );
    expect(owners).toEqual(['42', '9001']);
  });

  it('gives the two rows distinct record ids — they share a unique index', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('1')] });
    createApplicationFromDeal.mockResolvedValue({ id: 'vc_1' });
    await ingestVerificationDeals(ctx);

    const ids = createInboxMessage.mock.calls.map(
      (c) => (c[1] as { zohoRecordId: string }).zohoRecordId,
    );
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('vc:vc_1:sales');
    expect(ids).toContain('vc:vc_1:verification');
  });

  it('still tells Verification — loudly — when the Deal has no owner', async () => {
    getRecord.mockResolvedValue({ id: '1', Deal_Name: 'Orphan Co', Application_Date: '2026-08-15' });
    runCoql.mockResolvedValue({ rows: [dealRow('1')] });
    createApplicationFromDeal.mockResolvedValue({ id: 'vc_1' });
    await ingestVerificationDeals(ctx);

    expect(createInboxMessage).toHaveBeenCalledTimes(1);
    const msg = createInboxMessage.mock.calls[0]?.[1] as { ownerZohoUserId: string; priority: string };
    expect(msg.ownerZohoUserId).toBe('9001');
    // Raised: an application nobody has been asked to complete will otherwise sit red forever.
    expect(msg.priority).toBe('high');
  });

  it('does not fail the ingest when an inbox write fails', async () => {
    runCoql.mockResolvedValue({ rows: [dealRow('1')] });
    createInboxMessage.mockRejectedValue(new Error('inbox down'));
    const res = await ingestVerificationDeals(ctx);
    // The application row already exists; losing its announcement is not worth losing the run.
    expect(res.created).toBe(1);
    expect(res.failed).toBe(0);
  });
});
