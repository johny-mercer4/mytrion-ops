import { beforeEach, describe, expect, it, vi } from 'vitest';

type DrainResult = {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  pages: number;
};

const { runCoqlAllMock, getModuleFieldsMock } = vi.hoisted(() => ({
  runCoqlAllMock: vi.fn(),
  getModuleFieldsMock: vi.fn(),
}));

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: { runCoqlAll: runCoqlAllMock },
}));
vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: { getModuleFields: getModuleFieldsMock },
}));

import {
  fetchReferralCalculationRecords,
  resetReferralCalculationRecordsCache,
} from '../../src/modules/manager/referralRecords.js';

beforeEach(() => {
  resetReferralCalculationRecordsCache();
  runCoqlAllMock.mockReset();
  getModuleFieldsMock.mockReset();
});

describe('referral calculation source fetch', () => {
  it('starts three narrow, 2,000-row Zoho drains concurrently', async () => {
    const resolvers: Array<(result: DrainResult) => void> = [];
    runCoqlAllMock.mockImplementation(
      () =>
        new Promise<DrainResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const pending = fetchReferralCalculationRecords();

    expect(runCoqlAllMock).toHaveBeenCalledTimes(3);
    expect(getModuleFieldsMock).not.toHaveBeenCalled();
    for (const [, options] of runCoqlAllMock.mock.calls) {
      expect(options).toMatchObject({ pageSize: 2000 });
    }
    const queries = runCoqlAllMock.mock.calls.map(([query]) => String(query));
    expect(queries.some((query) => query.includes('from Parent_Referrers'))).toBe(true);
    expect(queries.some((query) => query.includes('from Child_Referrals'))).toBe(true);
    expect(queries.some((query) => query.includes('from Deals'))).toBe(true);
    expect(queries.some((query) => query.includes('from Leads'))).toBe(false);
    expect(queries.every((query) => query.includes('id desc'))).toBe(true);

    for (const resolve of resolvers) resolve({ rows: [], truncated: false, pages: 1 });
    const result = await pending;

    expect(result.parents.pages).toBe(1);
    expect(result.children.pages).toBe(1);
    expect(result.associations.deals.pages).toBe(1);
    expect(result.associations.leads.pages).toBe(0);
  });

  it('reuses the month-independent relationship graph until Refresh forces it', async () => {
    runCoqlAllMock.mockResolvedValue({ rows: [], truncated: false, pages: 1 });

    await fetchReferralCalculationRecords();
    await fetchReferralCalculationRecords();
    expect(runCoqlAllMock).toHaveBeenCalledTimes(3);

    await fetchReferralCalculationRecords({ force: true });
    expect(runCoqlAllMock).toHaveBeenCalledTimes(6);
  });
});
