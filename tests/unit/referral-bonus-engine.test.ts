/**
 * Referral bonus engine — the money rules and the join.
 *
 * Guards the three things that would quietly cost real money: paying the same carrier once per
 * child record instead of once per carrier, joining on the (empty) Parent_Referrer lookup instead
 * of the REF code, and awarding a one-time bonus below its threshold.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type OneTimeClaim = {
  bonusType: 'gallons_parent' | 'gallons_child';
  carrierId: number | null;
  childReferralId: string;
  status: 'calculated' | 'approved' | 'paid' | 'void';
};

const { coqlMock, volumeMock, upsertMock, startRunMock, finishRunMock, claimsMock } = vi.hoisted(
  () => ({
    coqlMock: vi.fn(),
    volumeMock: vi.fn(),
    upsertMock: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => input),
    startRunMock: vi.fn(async () => ({ id: 'run_1' })),
    finishRunMock: vi.fn(async () => undefined),
    claimsMock: vi.fn(async (): Promise<OneTimeClaim[]> => []),
  }),
);

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: {
    runCoql: coqlMock,
    /**
     * The engine drains both rosters (a parent missing from the map earns its referrer nothing), so it
     * calls runCoqlAll. The stub serves one page from the same `coqlMock` the tests program and adapts
     * it to the drain shape — `truncated: false` matters, because the engine refuses to calculate on a
     * partial roster.
     */
    runCoqlAll: async (q: string) => {
      const page = (await coqlMock(q)) as { rows: Record<string, unknown>[] };
      return { rows: page.rows, truncated: false, pages: 1 };
    },
  },
}));
vi.mock('../../src/integrations/dwhReferralVolume.js', () => ({ fetchReferralVolume: volumeMock }));
vi.mock('../../src/repos/referralBonusRepo.js', () => ({
  referralBonusRepo: {
    upsert: upsertMock,
    startRun: startRunMock,
    finishRun: finishRunMock,
    listOneTimeClaims: claimsMock,
  },
}));

import {
  previousMonthStart,
  runReferralBonusCalculation,
} from '../../src/modules/manager/referralBonusEngine.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';

const ctx = { tenantId: DEFAULT_TENANT_ID } as never;
const PERIOD = '2026-06-01';

/** Serve all three Zoho source drains. Deals default to one related Deal per child. */
function zoho(
  parents: Record<string, unknown>[],
  children: Record<string, unknown>[],
  deals = children.map((row, index) => ({
    id: `D${index + 1}`,
    Deal_Name: `Deal ${index + 1}`,
    Carrier_ID: row.Carrier_ID,
    Parent_Referrer: null,
    Child_Referrer: { id: row.id, name: row.Name },
  })),
) {
  coqlMock.mockReset();
  coqlMock.mockImplementation(async (q: string) => {
    if (q.includes('Parent_Referrers')) return { rows: parents, moreRecords: false };
    if (q.includes('Child_Referrals')) return { rows: children, moreRecords: false };
    return { rows: deals, moreRecords: false };
  });
}

function volume(
  map: Record<number, { gallons: number; swipes: number; cumulativeGallons: number }>,
) {
  volumeMock.mockReset();
  volumeMock.mockImplementation(async () => {
    const m = new Map<number, unknown>();
    for (const [k, v] of Object.entries(map)) m.set(Number(k), { carrierId: Number(k), ...v });
    return m;
  });
}

const PARENT = { id: 'P1', ReferrerId: 'REF-000002', Name: 'Parent Co' };
const child = (o: Record<string, unknown>) => ({
  id: 'C1',
  Referrer_ID: 'REF-000002',
  Parent_Referrer: null,
  Name: 'Child Co',
  Carrier_ID: '5799524',
  Calculation: 'Gallons (Legacy)',
  Paid: false,
  Parent_Paid: false,
  ...o,
});

beforeEach(() => {
  upsertMock.mockClear();
  startRunMock.mockClear();
  finishRunMock.mockClear();
  claimsMock.mockReset();
  claimsMock.mockResolvedValue([]);
});

describe('period selection', () => {
  it('a run on the 1st computes the month that just ended', () => {
    expect(previousMonthStart(new Date('2026-07-01T00:30:00Z'))).toBe('2026-06-01');
    expect(previousMonthStart(new Date('2026-01-01T00:30:00Z'))).toBe('2025-12-01');
  });
});

describe('joining child → parent', () => {
  it('joins on the REF code, not the (empty) Parent_Referrer lookup', async () => {
    zoho([PARENT], [child({ Parent_Referrer: null })]);
    volume({ 5799524: { gallons: 1000, swipes: 0, cumulativeGallons: 1000 } });
    await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0]![1]).toMatchObject({
      parentReferrerId: 'P1',
      parentName: 'Parent Co',
      recipientKind: 'parent',
      carrierId: 5799524,
      zohoDealId: 'D1',
      resolution: 'deal_lookup',
    });
  });

  it('does not pay a parent-recipient bonus when the REF code matches nothing', async () => {
    zoho([PARENT], [child({ Referrer_ID: 'REF-999999' })]);
    volume({ 5799524: { gallons: 1000, swipes: 0, cumulativeGallons: 1000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(s.unresolved).toBe(1);
  });

  it('requires the related Deal carrier id and never trusts Child_Referrals.Carrier_ID', async () => {
    zoho([PARENT], [child({ Carrier_ID: '5799524' })], []);
    volume({ 5799524: { gallons: 1000, swipes: 0, cumulativeGallons: 1000 } });
    const summary = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(summary.unresolved).toBe(1);
  });

  it('uses Deal.Carrier_ID when the referral module carries a different text carrier', async () => {
    zoho(
      [PARENT],
      [child({ Carrier_ID: '1111111' })],
      [
        {
          id: 'D-LIVE',
          Deal_Name: 'Child Deal',
          Carrier_ID: 5799524,
          Parent_Referrer: null,
          Child_Referrer: { id: 'C1', name: 'Child Co' },
        },
      ],
    );
    volume({ 5799524: { gallons: 1000, swipes: 0, cumulativeGallons: 1000 } });
    await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock.mock.calls[0]![1]).toMatchObject({
      carrierId: 5799524,
      zohoDealId: 'D-LIVE',
    });
  });
});

describe('carrier-level collapsing', () => {
  it('pays ONCE when several child records share a carrier', async () => {
    // The real data does this constantly — 4 of 4 live children share carrier 5799524.
    zoho([PARENT], [child({ id: 'C1' }), child({ id: 'C2' }), child({ id: 'C3' })]);
    volume({ 5799524: { gallons: 1000, swipes: 0, cumulativeGallons: 1000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(s.amountTotalUsd).toBe('10.00'); // 1000 gal x $0.01, not x3
  });

  it('is deterministic about which child record is paid', async () => {
    zoho([PARENT], [child({ id: 'C9' }), child({ id: 'C2' })]);
    volume({ 5799524: { gallons: 500, swipes: 0, cumulativeGallons: 500 } });
    await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    // Lowest record id wins, so a re-run cannot move the award to a sibling.
    expect(upsertMock.mock.calls[0]![1]).toMatchObject({ childReferralId: 'C2' });
  });
});

describe('the four logics', () => {
  /**
   * ONE picklist value selects exactly ONE bonus type (changed 2026-07-29).
   *
   * These two cases previously asserted the opposite — that either legacy value accrued BOTH legacy
   * bonuses — which made the two values indistinguishable in effect and silently paid the per-gallon
   * bonus on top of the per-swipe one for the 615 referrers set to 'Swipes (Legacy)'.
   */
  it('Swipes (Legacy) pays ONLY the per-swipe bonus, not per-gallon as well', async () => {
    zoho([PARENT], [child({ Calculation: 'Swipes (Legacy)' })]);
    volume({ 5799524: { gallons: 2500, swipes: 3, cumulativeGallons: 9000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });

    const byType = Object.fromEntries(
      upsertMock.mock.calls.map(([, i]) => [(i as Record<string, unknown>).bonusType, i]),
    );
    expect(Object.keys(byType)).toEqual(['swipes_legacy']);
    // $50 per NEW card (not per transaction), to the parent.
    expect(byType.swipes_legacy).toMatchObject({
      qtyNewCards: 3,
      amountUsd: '150.00',
      recipientKind: 'parent',
    });
    // The 2,500 gal would have added a $25.00 gallons_legacy row under the old expansion.
    expect(s.rowsWritten).toBe(1);
    expect(s.amountTotalUsd).toBe('150.00');
  });

  it('Gallons (Legacy) pays ONLY the per-gallon bonus', async () => {
    zoho([PARENT], [child({ Calculation: 'Gallons (Legacy)' })]);
    volume({ 5799524: { gallons: 2500, swipes: 3, cumulativeGallons: 9000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });

    const byType = Object.fromEntries(
      upsertMock.mock.calls.map(([, i]) => [(i as Record<string, unknown>).bonusType, i]),
    );
    expect(Object.keys(byType)).toEqual(['gallons_legacy']);
    expect(byType.gallons_legacy).toMatchObject({
      qtyGallons: '2500.00',
      rate: '0.0100',
      amountUsd: '25.00',
      recipientKind: 'parent',
    });
    expect(s.rowsWritten).toBe(1);
    expect(s.amountTotalUsd).toBe('25.00');
  });

  it('drives the logic from the PARENT when the child has no Calculation of its own', async () => {
    // The live shape: 665 of 687 parents populated, null on 100% of children. Reading the child alone
    // made every run write zero rows while reporting success.
    zoho([{ ...PARENT, Calculation: 'Gallons (Legacy)' }], [child({ Calculation: null })]);
    volume({ 5799524: { gallons: 1000, swipes: 2, cumulativeGallons: 1000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(s.skippedNoCalculation).toBe(0);
    expect(s.rowsWritten).toBe(1);
    expect(s.amountTotalUsd).toBe('10.00');
  });

  it('honours a non-null child Calculation as an explicit override of the parent', async () => {
    zoho(
      [{ ...PARENT, Calculation: 'Gallons (Legacy)' }],
      [child({ Calculation: 'Swipes (Legacy)' })],
    );
    volume({ 5799524: { gallons: 1000, swipes: 2, cumulativeGallons: 1000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock.mock.calls[0]![1]).toMatchObject({ bonusType: 'swipes_legacy' });
    expect(s.amountTotalUsd).toBe('100.00');
  });

  it('gallons_parent awards $50 once at 500 cumulative gallons', async () => {
    zoho([PARENT], [child({ Calculation: 'Gallons (Parent)' })]);
    volume({ 5799524: { gallons: 100, swipes: 0, cumulativeGallons: 520 } });
    await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock.mock.calls[0]![1]).toMatchObject({
      bonusType: 'gallons_parent',
      amountUsd: '50.00',
      cumulativeGallons: '520.00',
      recipientKind: 'parent',
    });
  });

  it('gallons_child pays the CHILD at 1,000 cumulative — the documented exception', async () => {
    zoho([PARENT], [child({ Calculation: 'Gallons (Child)' })]);
    volume({ 5799524: { gallons: 100, swipes: 0, cumulativeGallons: 1200 } });
    await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock.mock.calls[0]![1]).toMatchObject({
      bonusType: 'gallons_child',
      recipientKind: 'child',
      recipientName: 'Child Co',
      amountUsd: '50.00',
    });
  });

  it('writes NO row below a one-time threshold', async () => {
    zoho([PARENT], [child({ Calculation: 'Gallons (Child)' })]);
    volume({ 5799524: { gallons: 100, swipes: 0, cumulativeGallons: 999 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(s.rowsWritten).toBe(0);
  });

  it('does not re-award a one-time carrier already present in the ledger', async () => {
    claimsMock.mockResolvedValue([
      {
        bonusType: 'gallons_parent',
        carrierId: 5799524,
        childReferralId: 'OLDER-DUPLICATE',
        status: 'paid',
      },
    ]);
    zoho([PARENT], [child({ Calculation: 'Gallons (Parent)' })]);
    volume({ 5799524: { gallons: 100, swipes: 0, cumulativeGallons: 900 } });
    const summary = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(summary.rowsWritten).toBe(0);
  });

  it('treats an older child-keyed void row as a consumed one-time award', async () => {
    claimsMock.mockResolvedValue([
      {
        bonusType: 'gallons_child',
        carrierId: null,
        childReferralId: 'C1',
        status: 'void',
      },
    ]);
    zoho([PARENT], [child({ Calculation: 'Gallons (Child)' })]);
    volume({ 5799524: { gallons: 100, swipes: 0, cumulativeGallons: 1200 } });
    const summary = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(summary.rowsWritten).toBe(0);
  });

  it('honours Zoho Parent_Paid and Paid as one-time guards', async () => {
    zoho(
      [PARENT],
      [
        child({ id: 'C1', Calculation: 'Gallons (Parent)', Parent_Paid: true }),
        child({ id: 'C2', Calculation: 'Gallons (Child)', Paid: true, Carrier_ID: '5799525' }),
      ],
    );
    volume({
      5799524: { gallons: 100, swipes: 0, cumulativeGallons: 900 },
      5799525: { gallons: 100, swipes: 0, cumulativeGallons: 1500 },
    });
    const summary = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(summary.rowsWritten).toBe(0);
  });

  it('writes no row for a zero-volume month', async () => {
    zoho([PARENT], [child({ Calculation: 'Gallons (Legacy)' })]);
    volume({ 5799524: { gallons: 0, swipes: 0, cumulativeGallons: 0 } });
    await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('incomplete referral configuration', () => {
  it('computes nothing and reports it, rather than failing', async () => {
    zoho([PARENT], [child({ Calculation: null }), child({ id: 'C2', Calculation: null })]);
    volume({ 5799524: { gallons: 5000, swipes: 2, cumulativeGallons: 50000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(s.skippedNoCalculation).toBe(2);
    expect(s.rowsWritten).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(finishRunMock).toHaveBeenCalledWith(
      ctx,
      'run_1',
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('a child with no carrier id counts as unresolved', async () => {
    zoho([PARENT], [child({ Carrier_ID: null })]);
    volume({});
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(s.unresolved).toBe(1);
  });
});

describe('run audit', () => {
  it('marks the run failed and rethrows when Zoho errors', async () => {
    coqlMock.mockReset();
    coqlMock.mockRejectedValue(new Error('Zoho 502'));
    await expect(runReferralBonusCalculation(ctx, { periodMonth: PERIOD })).rejects.toThrow(
      'Zoho 502',
    );
    expect(finishRunMock).toHaveBeenCalledWith(
      ctx,
      'run_1',
      expect.objectContaining({ status: 'failed', error: 'Zoho 502' }),
    );
  });
});
