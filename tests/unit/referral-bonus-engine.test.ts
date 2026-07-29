/**
 * Referral bonus engine — the money rules and the join.
 *
 * Guards the three things that would quietly cost real money: paying the same carrier once per
 * child record instead of once per carrier, joining on the (empty) Parent_Referrer lookup instead
 * of the REF code, and awarding a one-time bonus below its threshold.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { coqlMock, volumeMock, upsertMock, startRunMock, finishRunMock } = vi.hoisted(() => ({
  coqlMock: vi.fn(),
  volumeMock: vi.fn(),
  upsertMock: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => input),
  startRunMock: vi.fn(async () => ({ id: 'run_1' })),
  finishRunMock: vi.fn(async () => undefined),
}));

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
  referralBonusRepo: { upsert: upsertMock, startRun: startRunMock, finishRun: finishRunMock },
}));

import {
  previousMonthStart,
  runReferralBonusCalculation,
} from '../../src/modules/manager/referralBonusEngine.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';

const ctx = { tenantId: DEFAULT_TENANT_ID } as never;
const PERIOD = '2026-06-01';

/** COQL is called parents-first, then children. */
function zoho(parents: Record<string, unknown>[], children: Record<string, unknown>[]) {
  coqlMock.mockReset();
  coqlMock.mockImplementation(async (q: string) =>
    q.includes('Parent_Referrers')
      ? { rows: parents, moreRecords: false }
      : { rows: children, moreRecords: false },
  );
}

function volume(map: Record<number, { gallons: number; swipes: number; cumulativeGallons: number }>) {
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
  Name: 'Child Co',
  Carrier_ID: '5799524',
  Calculation: 'Gallons (Legacy)',
  ...o,
});

beforeEach(() => {
  upsertMock.mockClear();
  startRunMock.mockClear();
  finishRunMock.mockClear();
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
    });
  });

  it('does not pay a parent-recipient bonus when the REF code matches nothing', async () => {
    zoho([PARENT], [child({ Referrer_ID: 'REF-999999' })]);
    volume({ 5799524: { gallons: 1000, swipes: 0, cumulativeGallons: 1000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(s.unresolved).toBe(1);
  });
});

describe('carrier-level collapsing', () => {
  it('pays ONCE when several child records share a carrier', async () => {
    // The real data does this constantly — 4 of 4 live children share carrier 5799524.
    zoho([PARENT], [
      child({ id: 'C1' }),
      child({ id: 'C2' }),
      child({ id: 'C3' }),
    ]);
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
    expect(byType.swipes_legacy).toMatchObject({ qtyNewCards: 3, amountUsd: '150.00', recipientKind: 'parent' });
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
    zoho([{ ...PARENT, Calculation: 'Gallons (Legacy)' }], [child({ Calculation: 'Swipes (Legacy)' })]);
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

  it('writes no row for a zero-volume month', async () => {
    zoho([PARENT], [child({ Calculation: 'Gallons (Legacy)' })]);
    volume({ 5799524: { gallons: 0, swipes: 0, cumulativeGallons: 0 } });
    await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('today’s live state — Calculation is unset everywhere', () => {
  it('computes nothing and reports it, rather than failing', async () => {
    zoho([PARENT], [child({ Calculation: null }), child({ id: 'C2', Calculation: null })]);
    volume({ 5799524: { gallons: 5000, swipes: 2, cumulativeGallons: 50000 } });
    const s = await runReferralBonusCalculation(ctx, { periodMonth: PERIOD });
    expect(s.skippedNoCalculation).toBe(2);
    expect(s.rowsWritten).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(finishRunMock).toHaveBeenCalledWith(ctx, 'run_1', expect.objectContaining({ status: 'succeeded' }));
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
    await expect(runReferralBonusCalculation(ctx, { periodMonth: PERIOD })).rejects.toThrow('Zoho 502');
    expect(finishRunMock).toHaveBeenCalledWith(
      ctx,
      'run_1',
      expect.objectContaining({ status: 'failed', error: 'Zoho 502' }),
    );
  });
});
