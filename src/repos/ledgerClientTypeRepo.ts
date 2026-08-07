import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  ledgerClientTypeOverrides,
  type LedgerClientTypeOverride,
} from '../db/schema/index.js';
import { firstOrThrow } from './util.js';

/**
 * ledgerClientTypeRepo — the effective-dated LOC/Prepay override store.
 *
 * PHASE 1 reads only the OPEN row (`effective_to is null`); the per-period interpretation is
 * deferred (TZ §8) and needs no schema change to enable — hence `listHistory`, which already exposes
 * the full chain the deferred phase will interpret.
 *
 * Opening a new override CLOSES the previous one in the same transaction, so the partial unique
 * index `ledger_client_type_overrides_open_uk` can never see two open rows for a carrier.
 */

export type LedgerClientTypeValue = 'LOC' | 'Prepay';

export interface OpenOverrideInput {
  carrierId: string;
  clientType: LedgerClientTypeValue;
  effectiveFrom: string;
  reason: string;
  dwhValueAtWrite?: string | null | undefined;
  createdByUserId?: string | undefined;
  createdByName?: string | undefined;
}

export const ledgerClientTypeRepo = {
  /** The open override for one carrier, or undefined. */
  async findOpen(carrierId: string): Promise<LedgerClientTypeOverride | undefined> {
    const rows = await db
      .select()
      .from(ledgerClientTypeOverrides)
      .where(
        and(
          eq(ledgerClientTypeOverrides.carrierId, String(carrierId).trim()),
          isNull(ledgerClientTypeOverrides.effectiveTo),
        ),
      )
      .limit(1);
    return rows[0];
  },

  /**
   * Open overrides for many carriers, as a Map keyed on carrier id. The resolver calls this ONCE per
   * request for the whole visible page — never per carrier.
   */
  async findOpenBatch(carrierIds: readonly string[]): Promise<Map<string, LedgerClientTypeOverride>> {
    const ids = [...new Set(carrierIds.map((c) => String(c).trim()).filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await db
      .select()
      .from(ledgerClientTypeOverrides)
      .where(
        and(
          inArray(ledgerClientTypeOverrides.carrierId, ids),
          isNull(ledgerClientTypeOverrides.effectiveTo),
        ),
      );
    return new Map(rows.map((r) => [r.carrierId, r]));
  },

/**
   * EVERY open override, unfiltered.
   *
   * Use this — not `findOpenBatch` — whenever the caller wants the whole book. The overrides table holds
   * at most one row per carrier and in practice a handful, whereas passing 8,145 carrier ids to
   * `findOpenBatch` builds an `IN (...)` with 8,145 bind parameters and ships it to the database. On a
   * localhost Postgres that is merely wasteful; against the managed instance it is a multi-megabyte
   * query over a WAN and was the cause of the Ledger tab timing out.
   */
  async findOpenAll(): Promise<Map<string, LedgerClientTypeOverride>> {
    const rows = await db
      .select()
      .from(ledgerClientTypeOverrides)
      .where(isNull(ledgerClientTypeOverrides.effectiveTo));
    return new Map(rows.map((r) => [r.carrierId, r]));
  },

  /** Every override ever recorded for a carrier, newest effective period first. */
  async listHistory(carrierId: string): Promise<LedgerClientTypeOverride[]> {
    return db
      .select()
      .from(ledgerClientTypeOverrides)
      .where(eq(ledgerClientTypeOverrides.carrierId, String(carrierId).trim()))
      .orderBy(desc(ledgerClientTypeOverrides.effectiveFrom), desc(ledgerClientTypeOverrides.id));
  },

  /**
   * Close any open override and open a new one, atomically. The outgoing row's `effective_to` is set
   * to `effectiveFrom − 1 day` so the two periods abut without overlapping — an overlap would make
   * the deferred per-period resolver ambiguous.
   */
  async openOverride(
    input: OpenOverrideInput,
  ): Promise<{ row: LedgerClientTypeOverride; previous: LedgerClientTypeOverride | null }> {
    const carrierId = String(input.carrierId).trim();
    return db.transaction(async (tx) => {
      const openRows = await tx
        .select()
        .from(ledgerClientTypeOverrides)
        .where(
          and(
            eq(ledgerClientTypeOverrides.carrierId, carrierId),
            isNull(ledgerClientTypeOverrides.effectiveTo),
          ),
        )
        .limit(1);
      const previous = openRows[0] ?? null;

      if (previous) {
        await tx
          .update(ledgerClientTypeOverrides)
          .set({
            effectiveTo: sql`(${input.effectiveFrom}::date - interval '1 day')::date`,
            closedAt: new Date(),
            closedByName: input.createdByName ?? null,
          })
          .where(eq(ledgerClientTypeOverrides.id, previous.id));
      }

      const inserted = await tx
        .insert(ledgerClientTypeOverrides)
        .values({
          carrierId,
          clientType: input.clientType,
          effectiveFrom: input.effectiveFrom,
          reason: input.reason,
          dwhValueAtWrite: input.dwhValueAtWrite ?? null,
          createdByUserId: input.createdByUserId ?? null,
          createdByName: input.createdByName ?? null,
        })
        .returning();

      return { row: firstOrThrow(inserted, 'ledger client-type override insert returned no row'), previous };
    });
  },

  /**
   * Close the open override without opening a replacement — the carrier reverts to DWH truth.
   * Returns the closed row, or null when there was nothing open.
   */
  async closeOpen(
    carrierId: string,
    opts: { closedByName?: string | undefined; effectiveTo?: string | undefined } = {},
  ): Promise<LedgerClientTypeOverride | null> {
    const id = String(carrierId).trim();
    const updated = await db
      .update(ledgerClientTypeOverrides)
      .set({
        effectiveTo: opts.effectiveTo ?? sql`current_date`,
        closedAt: new Date(),
        closedByName: opts.closedByName ?? null,
      })
      .where(
        and(
          eq(ledgerClientTypeOverrides.carrierId, id),
          isNull(ledgerClientTypeOverrides.effectiveTo),
        ),
      )
      .returning();
    return updated[0] ?? null;
  },
};
