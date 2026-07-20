/**
 * findDwhCardByNumber — the lookup that binds a self-registering driver to a carrier by card
 * possession alone (no owner gate). Two invariants matter here because the result is a security
 * boundary: (a) ONLY active cards resolve (is_active = true), and (b) a card number that resolves
 * to more than one carrier must fail closed rather than bind the driver to an arbitrary one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DWH_DATABASE_URL = 'postgres://dwh.example/analytics';
});

vi.mock('../../src/integrations/dwh.js', () => ({
  dwhQuery: vi.fn(async () => []),
  getDwhPool: vi.fn(),
  closeDwhPool: vi.fn(async () => undefined),
}));

import { dwhQuery } from '../../src/integrations/dwh.js';
import { findDwhCardByNumber } from '../../src/integrations/dwhCards.js';

const query = vi.mocked(dwhQuery);
const CARD = '7083050030880417593';

beforeEach(() => query.mockReset());

describe('findDwhCardByNumber', () => {
  it('resolves a single active card to its carrier', async () => {
    query.mockResolvedValueOnce([{ card_id: 'card_1', carrier_id: '5765985', card_number: CARD }]);

    const card = await findDwhCardByNumber(CARD);

    expect(card).toEqual({ cardId: 'card_1', carrierId: '5765985', cardNumber: CARD });
  });

  it('only matches active cards — the query filters is_active = true', async () => {
    query.mockResolvedValueOnce([]);

    const card = await findDwhCardByNumber(CARD);

    expect(card).toBeNull();
    // The active-only rule is enforced in SQL, not by the caller — a deactivated card never returns
    // a row, so it can never be used to log in.
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toMatch(/is_active\s*=\s*true/);
  });

  it('returns null for an unknown card', async () => {
    query.mockResolvedValueOnce([]);
    expect(await findDwhCardByNumber('0000000000000000000')).toBeNull();
  });

  it('binds to the first row (and does NOT fail closed) when the duplicate is within ONE carrier', async () => {
    // Same carrier on both rows: the carrier binding — the security-relevant part — is unambiguous,
    // so refusing here would lock a real driver out over a data-hygiene problem. A warn is logged
    // (asserted implicitly by coverage of the branch; the log itself is ops-facing).
    query.mockResolvedValueOnce([
      { card_id: 'card_1', carrier_id: '5765985', card_number: CARD },
      { card_id: 'card_9', carrier_id: '5765985', card_number: CARD },
    ]);

    const card = await findDwhCardByNumber(CARD);

    expect(card).toEqual({ cardId: 'card_1', carrierId: '5765985', cardNumber: CARD });
  });

  it('fails closed when the same active number resolves to TWO DIFFERENT carriers', async () => {
    // No uniqueness constraint on card_number in the replica — a bare limit-1 would bind the driver
    // to whichever row the DB happened to return. Refuse instead of guessing.
    query.mockResolvedValueOnce([
      { card_id: 'card_1', carrier_id: '5765985', card_number: CARD },
      { card_id: 'card_9', carrier_id: '9999999', card_number: CARD },
    ]);

    expect(await findDwhCardByNumber(CARD)).toBeNull();
  });

  it('still resolves when duplicate rows all belong to the SAME carrier', async () => {
    // Staging replicas can carry dupe rows for one card under one carrier — that is unambiguous.
    query.mockResolvedValueOnce([
      { card_id: 'card_1', carrier_id: '5765985', card_number: CARD },
      { card_id: 'card_1', carrier_id: '5765985', card_number: CARD },
    ]);

    const card = await findDwhCardByNumber(CARD);
    expect(card).toMatchObject({ carrierId: '5765985' });
  });

  it('caps the lookup at two rows so the ambiguity check is cheap', async () => {
    query.mockResolvedValueOnce([{ card_id: 'card_1', carrier_id: '5765985', card_number: CARD }]);
    await findDwhCardByNumber(CARD);
    expect(String(query.mock.calls[0]?.[0])).toMatch(/limit\s+2/i);
  });
});
