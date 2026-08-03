/**
 * Finance EFS / money-code readers.
 *
 * The point of these is the masking: EFS hands back the full, redeemable money code on every row of
 * `getMoneyCodes`, and an unredeemed code is a bearer instrument. If `code` ever survives into a
 * response, anyone with Finance access (or a captured payload) can draw the cash. So the tests use
 * a fixture that deliberately contains a full code and assert it cannot be found in the output —
 * not just that `codeLast4` looks right.
 *
 * Also covered: the 90-day window clamp (EFS 400s on wider), and the epoch void-date sentinel that
 * would otherwise render as "voided in 1970".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../src/integrations/serverCrm.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/integrations/serverCrm.js')>();
  return { ...original, serverCrm: { ...original.serverCrm, get } };
});

import {
  EFS_MAX_WINDOW_DAYS,
  efsWindow,
  fetchCarrierMoneyCodes,
  fetchEfsLoads,
  fetchEfsSnapshot,
  fetchMoneyCodeDetail,
} from '../../src/modules/finance/financeEfs.js';

/** A real `getMoneyCodes` row, shape-for-shape (prod, carrier 5816754) — full code included. */
const FULL_CODE = '1464645748';
const MC_ROW = {
  id: '164407678',
  alphaCode: null,
  code: FULL_CODE,
  status: 'USED',
  efsStatus: 'ACTIVE',
  amount: 32,
  amountUsed: 32,
  amountRemaining: 0,
  feeAmount: 3.5,
  contractId: '680634',
  issuedTo: '5816754',
  carrierId: 5816754,
  notes: 'B-12 For lumper fee',
  payee: null,
  who: 'danamay',
  codeType: 'E_MANAGER',
  numUses: 0,
  created: '2026-07-22T05:03:00.000-05:00',
  activeDate: '2026-07-22T05:03:00.000-05:00',
  firstUse: '2026-07-22 05:08',
  voided: false,
  // EFS's "never voided" sentinel.
  voidDate: '1970-01-01T00:00:00.000-06:00',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('efsWindow — rolling', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');

  it('defaults to 30 days', () => {
    expect(efsWindow(undefined, now).days).toBe(30);
  });

  it('clamps to EFS’s own 90-day ceiling rather than letting upstream 400', () => {
    expect(efsWindow(365, now).days).toBe(EFS_MAX_WINDOW_DAYS);
    expect(EFS_MAX_WINDOW_DAYS).toBe(90);
  });

  it('floors at a single day', () => {
    expect(efsWindow(0, now).days).toBe(1);
    expect(efsWindow(-10, now).days).toBe(1);
  });

  it('spans exactly `days` back from now', () => {
    const w = efsWindow(7, now);
    expect(w.to).toBe('2026-08-04T12:00:00.000Z');
    expect(w.from).toBe('2026-07-28T12:00:00.000Z');
    expect(w.custom).toBe(false);
  });
});

describe('efsWindow — custom range', () => {
  /**
   * Both ends are INCLUSIVE calendar days. Picking one date twice must return that day's movements,
   * not an empty window — the bug you get from naively using midnight for both bounds.
   */
  /**
   * Bounds are CENTRAL, not UTC — EFS stamps its rows CT, so a UTC midnight bound drags in the
   * previous CT evening and "1–31 July" returns a movement dated 30 June. June is CDT (-05:00), so
   * 00:00 CT is 05:00Z.
   */
  it('covers whole CENTRAL days at both ends', () => {
    const w = efsWindow({ from: '2026-06-01', to: '2026-06-30' });
    expect(w.from).toBe('2026-06-01T05:00:00.000Z');
    expect(w.to).toBe('2026-07-01T04:59:59.999Z');
    expect(w.days).toBe(30);
    expect(w.custom).toBe(true);
  });

  /** January is CST (-06:00). Hardcoding one offset would shift a whole day's movements. */
  it('uses the right Central offset across DST', () => {
    expect(efsWindow({ from: '2026-01-05', to: '2026-01-05' }).from).toBe('2026-01-05T06:00:00.000Z');
    expect(efsWindow({ from: '2026-07-05', to: '2026-07-05' }).from).toBe('2026-07-05T05:00:00.000Z');
  });

  it('a single day is one day, not zero', () => {
    const w = efsWindow({ from: '2026-07-15', to: '2026-07-15' });
    expect(w.days).toBe(1);
    expect(w.from).toBe('2026-07-15T05:00:00.000Z');
    expect(w.to).toBe('2026-07-16T04:59:59.999Z');
  });

  /** A range spanning the spring-forward day is 23 hours short of a whole multiple of 24. */
  it('counts days correctly across a DST transition', () => {
    // US DST begins 8 March 2026.
    expect(efsWindow({ from: '2026-03-01', to: '2026-03-31' }).days).toBe(31);
  });

  it('accepts a range exactly at the 90-day ceiling', () => {
    // 2026-05-07 → 2026-08-04 inclusive is 90 days.
    expect(efsWindow({ from: '2026-05-07', to: '2026-08-04' }).days).toBe(90);
  });

  it('rejects a span past the ceiling with a 400, not a vendor SOAP fault', () => {
    expect(() => efsWindow({ from: '2026-01-01', to: '2026-08-04' })).toThrow(/keeps only 90 days/);
  });

  it('rejects an inverted pair', () => {
    expect(() => efsWindow({ from: '2026-08-04', to: '2026-06-01' })).toThrow(/starts after it ends/);
  });

  it('rejects a half-given range and a malformed date', () => {
    expect(() => efsWindow({ from: '2026-06-01' })).toThrow(/both from and to/);
    expect(() => efsWindow({ to: '2026-06-01' })).toThrow(/both from and to/);
    expect(() => efsWindow({ from: '01/06/2026', to: '30/06/2026' })).toThrow(/yyyy-mm-dd/);
    expect(() => efsWindow({ from: '2026-02-30', to: '2026-03-01' })).toThrow(/not a real date/);
  });

  it('explicit dates win over a rolling count given alongside them', () => {
    const w = efsWindow({ days: 7, from: '2026-06-01', to: '2026-06-10' });
    expect(w.custom).toBe(true);
    expect(w.days).toBe(10);
  });
});

describe('money codes never carry the redeemable digits', () => {
  it('strips `code` from the list and keeps only the last four', async () => {
    get.mockResolvedValue({ success: true, summary: { total: 1 }, data: [MC_ROW] });
    const res = await fetchCarrierMoneyCodes('5816754', 60, 'ALL');

    // The whole security property, asserted on the serialized payload.
    expect(JSON.stringify(res)).not.toContain(FULL_CODE);
    expect(JSON.stringify(res)).not.toMatch(/"(code|alphaCode)"\s*:/);

    const code = res.codes[0];
    expect(code?.codeLast4).toBe('5748');
    expect(code?.id).toBe('164407678');
    expect(code?.amount).toBe(32);
    expect(code?.issuedBy).toBe('danamay');
  });

  it('strips the digits from the detail read too', async () => {
    get.mockResolvedValue({
      success: true,
      data: {
        lookup: 'codeId',
        codeId: 164407678,
        status: 'ACTIVE',
        code: FULL_CODE,
        amount: 32,
        amountUsed: 32,
        uses: [{ amount: 32, checkNumber: '1957688595', time: '2026-07-22T05:08:00.000-05:00' }],
        firstUse: '2026-07-22 05:08',
        voided: false,
        voidDate: null,
      },
    });
    const detail = await fetchMoneyCodeDetail('164407678');
    expect(JSON.stringify(detail)).not.toContain(FULL_CODE);
    expect(detail.codeLast4).toBe('5748');
    expect(detail.uses).toHaveLength(1);
    expect(detail.uses[0]?.checkNumber).toBe('1957688595');
  });

  it('normalizes the epoch void sentinel to null instead of "1970"', async () => {
    get.mockResolvedValue({ success: true, summary: { total: 1 }, data: [MC_ROW] });
    const res = await fetchCarrierMoneyCodes('5816754');
    expect(res.codes[0]?.voided).toBe(false);
    expect(res.codes[0]?.voidedAt).toBeNull();
  });

  it('keeps a real void date when the code actually was voided', async () => {
    get.mockResolvedValue({
      success: true,
      summary: { total: 1 },
      data: [{ ...MC_ROW, status: 'VOIDED', voided: true, voidDate: '2026-07-30T10:00:00.000-05:00' }],
    });
    const res = await fetchCarrierMoneyCodes('5816754');
    expect(res.codes[0]?.voided).toBe(true);
    expect(res.codes[0]?.voidedAt).toBe('2026-07-30T10:00:00.000-05:00');
  });

  it('sums the EFS fees, which the upstream summary does not report', async () => {
    get.mockResolvedValue({
      success: true,
      summary: { total: 2 },
      data: [MC_ROW, { ...MC_ROW, id: '2', feeAmount: 1.5 }],
    });
    const res = await fetchCarrierMoneyCodes('5816754');
    expect(res.summary.feeTotal).toBe(5);
  });

  it('passes the window and status through to the upstream filter', async () => {
    get.mockResolvedValue({ success: true, data: [] });
    await fetchCarrierMoneyCodes('5816754', 7, 'OPEN');
    const [path, query] = get.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/efs/touchpoints/money-codes');
    expect(query).toMatchObject({ status: 'OPEN', carrierId: '5816754' });
  });

  it('sends a custom range as the resolved instants, and echoes it back', async () => {
    get.mockResolvedValue({ success: true, data: [] });
    const res = await fetchCarrierMoneyCodes('5816754', { from: '2026-06-01', to: '2026-06-30' }, 'ALL');
    const [, query] = get.mock.calls[0] as [string, Record<string, unknown>];
    // Central bounds — see the efsWindow tests for why these are not UTC midnight.
    expect(query).toMatchObject({
      from: '2026-06-01T05:00:00.000Z',
      to: '2026-07-01T04:59:59.999Z',
    });
    // The panel's caption reads the echoed window, so it must survive the round trip.
    expect(res.window).toMatchObject({ days: 30, custom: true });
  });

  it('refuses an over-wide custom range before any upstream call', async () => {
    await expect(
      fetchCarrierMoneyCodes('5816754', { from: '2026-01-01', to: '2026-08-04' }),
    ).rejects.toThrow(/keeps only 90 days/);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('fund movements', () => {
  it('classifies by sign and carries the upstream roll-up', async () => {
    get.mockResolvedValue({
      success: true,
      summary: {
        total: 2,
        topups: { count: 1, amount: 988 },
        sweeps: { count: 1, amount: 261.26 },
        net: 726.74,
      },
      data: [
        { direction: 'SWEEP', amount: -261.26, amountAbs: 261.26, contractId: 863440, when: '2026-08-01T12:07:00.000-05:00', responseId: null, refNum: null },
        { direction: 'TOPUP', amount: 988, amountAbs: 988, contractId: 863440, when: '2026-08-01T10:50:00.000-05:00', responseId: '54885649', refNum: 'REF167065816754' },
      ],
    });
    const res = await fetchEfsLoads('5816754', 30);
    expect(res.loads.map((l) => l.direction)).toEqual(['SWEEP', 'TOPUP']);
    expect(res.summary.net).toBe(726.74);
    // A sweep with no id must still keep its nulls rather than becoming an empty string.
    expect(res.loads[0]?.responseId).toBeNull();
    expect(res.loads[1]?.refNum).toBe('REF167065816754');
  });

  it('falls back to the amount sign when upstream omits `direction`', async () => {
    get.mockResolvedValue({ success: true, data: [{ amount: -50 }, { amount: 50 }] });
    const res = await fetchEfsLoads('5816754');
    expect(res.loads.map((l) => l.direction)).toEqual(['SWEEP', 'TOPUP']);
    expect(res.loads[0]?.amountAbs).toBe(50);
  });
});

describe('carrier snapshot', () => {
  it('normalizes contracts and cards, and surfaces a partial answer', async () => {
    get.mockResolvedValue({
      success: true,
      carrierId: 5816754,
      totalBalance: 161.59,
      contracts: [{ contractId: '863440', description: 'GSD TRANSPORT INC', balance: 161.59 }],
      cards: [{ cardNumber: '7083350430000123456', status: 'A', type: 'FLEET', balance: 100 }],
      cardCount: 12,
      cardDetailError: 'card detail timed out',
      fetchedAt: '2026-08-04T00:00:00.000Z',
    });
    const snap = await fetchEfsSnapshot('5816754');
    expect(snap.totalBalance).toBe(161.59);
    expect(snap.contracts[0]?.contractId).toBe('863440');
    // cardCount is EFS's own count — it can exceed the detail rows that came back.
    expect(snap.cardCount).toBe(12);
    expect(snap.cardDetailError).toBe('card detail timed out');
  });

  it('turns an upstream `success:false` body into a 502 rather than an empty panel', async () => {
    get.mockResolvedValue({ success: false, error: 'soapenv:Server: something broke' });
    await expect(fetchEfsSnapshot('5816754')).rejects.toThrow(/EFS carrier snapshot failed/);
  });
});
