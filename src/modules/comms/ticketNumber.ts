import { sql } from 'drizzle-orm';
import type { CommsTicketKind } from '../../db/schema/index.js';
import type { DbOrTx } from '../../db/client.js';

/**
 * Human-readable ticket numbers: `T-000123` / `R-000045` / `E-000012`.
 *
 * One global Postgres sequence (`mytrion_comms_number_seq`, created in 0086) formatted per kind at
 * insert time. Consequences, all deliberate — see the DDL comment:
 *   * The number is globally monotone, NOT per-tenant contiguous. A rolled-back transaction burns a
 *     value, which is invisible in a ticket number and costs nothing.
 *   * `nextval` is non-transactional, so it never blocks and two concurrent creates cannot collide —
 *     which is the whole point. A per-tenant counter row would serialise every create in the tenant
 *     on one row to buy a contiguity nobody needs.
 *   * The three kinds SHARE the sequence, so T-000001 and E-000002 can both exist. The prefix
 *     disambiguates; a per-kind sequence would need three more objects for a cosmetic property.
 */

const PREFIX_BY_KIND: Record<CommsTicketKind, string> = {
  ticket: 'T',
  request: 'R',
  escalation: 'E',
};

/** Zero-pad width. 6 digits reads as a ticket number and still formats past a million without breaking. */
const PAD = 6;

/**
 * Allocate the next number for a kind.
 *
 * Takes the transaction handle so the caller can allocate inside the create transaction. The value is
 * consumed from the sequence either way (nextval ignores rollback), so passing a tx buys ordering with
 * the insert, not atomicity of the counter.
 */
export async function allocateTicketNumber(
  tx: DbOrTx,
  kind: CommsTicketKind,
): Promise<string> {
  // ::text because bigint arrives as a string anyway under postgres.js — casting in SQL makes that
  // explicit instead of leaving the padding to depend on driver number coercion.
  const rows = await tx.execute<{ n: string }>(
    sql`SELECT nextval('mytrion_comms_number_seq')::text AS n`,
  );
  const raw = rows[0]?.n;
  if (raw === undefined) {
    throw new Error('mytrion_comms_number_seq returned no value');
  }
  return formatTicketNumber(kind, raw);
}

/** Pure formatter — split out so the padding rule is unit-testable without a database. */
export function formatTicketNumber(kind: CommsTicketKind, value: string | number): string {
  const digits = String(value).replace(/\D/g, '');
  return `${PREFIX_BY_KIND[kind]}-${digits.padStart(PAD, '0')}`;
}
