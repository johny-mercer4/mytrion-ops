/**
 * DWH fuel card directory — the carrier's active fuel cards from `octane.stg_cmp_card`
 * (current row via is_active). No driver identity exists on the card itself
 * (`card_name` is unpopulated across the whole table) — this is what the admin picks a
 * driver's `card_id` FROM when binding a `carrier_users` driver account. Read-only.
 */
import { dwhQuery } from './dwh.js';
import { logger } from '../lib/logger.js';

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

/**
 * Enough to hold any real carrier's whole fleet in one read.
 *
 * Measured against the live DWH across 7967 carriers: p99 is 46 active cards, 16 carriers exceed
 * 100, exactly one exceeds 500, and the largest is 510 — 53 KB of JSON. So the fleet screen does not
 * need pagination; it needs a bound that isn't below the data. Paging it would also break the
 * screen's own filter counts and search, which run over the whole list client-side.
 *
 * Still a bound, not "unlimited": it caps the blast radius of a data anomaly, and a carrier that
 * ever approaches it is the signal that this decision needs revisiting.
 */
export const FLEET_CARD_LIMIT = 1000;

/** Exact count of a carrier's active cards. A count, not a list to measure — the list is capped and
 *  `cards.length` against it silently reports the cap instead of the truth. */
export async function countDwhCards(carrierId: string): Promise<number> {
  const rows = await dwhQuery<{ n: number }>(
    `select count(*)::int as n from octane.stg_cmp_card where is_active = true and carrier_id = $1`,
    [carrierId],
  );
  return rows[0]?.n ?? 0;
}

/** Active fuel cards for one carrier — current rows only, newest first. */
export async function listDwhCards(carrierId: string, limit = 100): Promise<DwhCard[]> {
  const capped = Math.min(Math.max(limit, 1), FLEET_CARD_LIMIT);
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

/**
 * Is this card an active card of this carrier? An exact lookup, not a scan.
 *
 * The membership check used to run `listDwhCards(carrierId).some(c => c.cardId === cardId)` — over a
 * list capped at 100 (200 hard max). Real carriers are far bigger: measured live, 5809710 has 510
 * active cards, 5794015 has 230. So a driver whose card sorted past the first 100 was told "That
 * card is not an active card of this carrier" and could not register AT ALL — the check answered
 * "does your card appear in the newest 100" while claiming to answer "is your card active".
 *
 * Asking the database about the one card removes the cap from the question entirely.
 */
export async function findDwhCardById(carrierId: string, cardId: string): Promise<DwhCard | null> {
  const rows = await dwhQuery<CardRow>(
    `select card_id, card_number, card_type, status, balance
       from octane.stg_cmp_card
      where is_active = true and carrier_id = $1 and card_id = $2
      limit 1`,
    [carrierId, cardId],
  );
  return rows[0] ? toDto(rows[0]) : null;
}

/** Same exact lookup WITHOUT the active-only clause — for READ paths only (the owner's
 *  transaction-history filter): a deactivated card's past transactions are still the owner's to
 *  report on. Every WRITE path keeps using findDwhCardById (active-only) above. */
export async function findDwhCardByIdAnyStatus(carrierId: string, cardId: string): Promise<DwhCard | null> {
  const rows = await dwhQuery<CardRow>(
    `select card_id, card_number, card_type, status, balance
       from octane.stg_cmp_card
      where carrier_id = $1 and card_id = $2
      limit 1`,
    [carrierId, cardId],
  );
  return rows[0] ? toDto(rows[0]) : null;
}

export async function isActiveCardOfCarrier(carrierId: string, cardId: string): Promise<boolean> {
  return (await findDwhCardById(carrierId, cardId)) !== null;
}

/** The carrier + card a fuel-card NUMBER resolves to — drives driver self-registration (the number
 * is printed on the physical card, so possession identifies the carrier/card). Active cards only. */
export interface DwhCardOwner {
  cardId: string;
  carrierId: string;
  cardNumber: string;
}

export async function findDwhCardByNumber(cardNumber: string): Promise<DwhCardOwner | null> {
  // `limit 2`, not `limit 1`: `card_number` has no uniqueness constraint on this read-only replica,
  // and this lookup is what binds a self-registering driver to a carrier by card possession alone.
  // If the same active number resolves to TWO DIFFERENT carriers, a bare `limit 1` (no ORDER BY)
  // would bind the driver to an arbitrary one — so fail closed instead of guessing.
  const rows = await dwhQuery<{ card_id: string | number | null; carrier_id: string | number | null; card_number: string | null }>(
    `select card_id, carrier_id, card_number
       from octane.stg_cmp_card
      where is_active = true and card_number = $1
      limit 2`,
    [cardNumber],
  );
  const row = rows[0];
  if (!row || row.card_id == null || row.carrier_id == null) return null;
  if (rows.length > 1 && rows[1]?.carrier_id != null && String(rows[1].carrier_id) !== String(row.carrier_id)) {
    logger.warn(
      { cardNumber, carriers: [String(row.carrier_id), String(rows[1].carrier_id)] },
      'findDwhCardByNumber: card number resolves to multiple carriers — refusing to bind',
    );
    return null;
  }
  if (rows.length > 1 && rows[1]?.card_id != null && String(rows[1].card_id) !== String(row.card_id)) {
    // Same carrier this time (the cross-carrier case returned null above), same ACTIVE number on two
    // different card rows. The carrier binding — the security-relevant part — is unambiguous, and
    // driver row-scoping filters on the NUMBER, so reads are unaffected; but which card_id the
    // registration pins is arbitrary. Surfaced so ops can clean up the duplicate at the source.
    logger.warn(
      { cardNumber, carrierId: String(row.carrier_id), cardIds: [String(row.card_id), String(rows[1].card_id)] },
      'findDwhCardByNumber: duplicate active card number within one carrier — binding to the first row',
    );
  }
  return { cardId: String(row.card_id), carrierId: String(row.carrier_id), cardNumber: String(row.card_number ?? cardNumber) };
}

/** A carrier's company profile — the fields the mini-app's owner profile sheet surfaces. */
export interface DwhCompanyDetails {
  carrierId: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Company contact + address for one carrier, from octane.dim_company (read-only replica).
 * Null when the carrier has no dim_company row. All fields are optional in the source, so any may
 * come back null.
 *
 * Phone matches Sales roster: prefer `deal_phone`, fall back to `contact_phone` (many deals only
 * populate deal_phone).
 */
export async function getDwhCompanyDetails(carrierId: string): Promise<DwhCompanyDetails | null> {
  const rows = await dwhQuery<{
    carrier_id: string | number | null;
    company_name: string | null;
    contact_email: string | null;
    deal_phone: string | null;
    contact_phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
  }>(
    `select carrier_id, company_name, contact_email, deal_phone, contact_phone,
            address, city, state, zip_code
       from octane.dim_company
      where carrier_id = $1
      limit 1`,
    [carrierId],
  );
  const r = rows[0];
  if (!r) return null;
  const s = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    carrierId: String(r.carrier_id ?? carrierId),
    companyName: s(r.company_name),
    email: s(r.contact_email),
    phone: s(r.deal_phone) ?? s(r.contact_phone),
    address: s(r.address),
    city: s(r.city),
    state: s(r.state),
    zip: s(r.zip_code),
  };
}


/**
 * Any-status variant of findDwhCardByNumber — for MERGE/READ paths where a deactivated card
 * must still resolve its stable card_id (EFS-first fleet merge; owner card-ops on an inactive
 * card — "activate it" being the whole point). Same fail-closed ambiguity guard: 0 or 2+
 * conflicting rows resolve to null, never a guess.
 */
export async function findDwhCardByNumberAnyStatus(cardNumber: string): Promise<DwhCardOwner | null> {
  const rows = await dwhQuery<{ card_id: string | number | null; carrier_id: string | number | null; card_number: string | null }>(
    `select card_id, carrier_id, card_number
       from octane.stg_cmp_card
      where card_number = $1
      limit 2`,
    [cardNumber],
  );
  const row = rows[0];
  if (!row || row.card_id == null || row.carrier_id == null) return null;
  if (rows.length > 1 && rows[1]?.carrier_id != null && String(rows[1].carrier_id) !== String(row.carrier_id)) return null;
  return { cardId: String(row.card_id), carrierId: String(row.carrier_id), cardNumber: String(row.card_number ?? '') };
}
