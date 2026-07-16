/**
 * DWH fuel card directory — the carrier's active fuel cards from `octane.stg_cmp_card`
 * (current row via is_active). No driver identity exists on the card itself
 * (`card_name` is unpopulated across the whole table) — this is what the admin picks a
 * driver's `card_id` FROM when binding a `carrier_users` driver account. Read-only.
 */
import { dwhQuery } from './dwh.js';

export interface DwhCard {
  cardId: string | null;
  cardNumber: string | null;
  cardType: string | null;
  status: string | null;
  balance: string | null;
}

interface CardRow {
  card_id: string | number | null;
  card_number: string | null;
  card_type: string | null;
  status: string | null;
  balance: string | number | null;
}

function toDto(row: CardRow): DwhCard {
  return {
    cardId: row.card_id != null ? String(row.card_id) : null,
    cardNumber: row.card_number,
    cardType: row.card_type,
    status: row.status,
    balance: row.balance != null ? String(row.balance) : null,
  };
}

/** Active fuel cards for one carrier — current rows only, newest first. */
export async function listDwhCards(carrierId: string, limit = 100): Promise<DwhCard[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await dwhQuery<CardRow>(
    `select card_id, card_number, card_type, status, balance
       from octane.stg_cmp_card
      where is_active = true and carrier_id = $1
      order by card_id desc
      limit ${capped}`,
    [carrierId],
  );
  return rows.map(toDto);
}

/** The carrier + card a fuel-card NUMBER resolves to — drives driver self-registration (the number
 * is printed on the physical card, so possession identifies the carrier/card). Active cards only. */
export interface DwhCardOwner {
  cardId: string;
  carrierId: string;
  cardNumber: string;
}

export async function findDwhCardByNumber(cardNumber: string): Promise<DwhCardOwner | null> {
  const rows = await dwhQuery<{ card_id: string | number | null; carrier_id: string | number | null; card_number: string | null }>(
    `select card_id, carrier_id, card_number
       from octane.stg_cmp_card
      where is_active = true and card_number = $1
      limit 1`,
    [cardNumber],
  );
  const row = rows[0];
  if (!row || row.card_id == null || row.carrier_id == null) return null;
  return { cardId: String(row.card_id), carrierId: String(row.carrier_id), cardNumber: String(row.card_number ?? cardNumber) };
}
