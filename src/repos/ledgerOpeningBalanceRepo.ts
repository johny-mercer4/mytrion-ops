import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
import { ConflictError } from '../lib/errors.js';
import {
  ledgerOpeningBalances,
  type LedgerOpeningBalance,
  type LedgerOpeningSource,
} from '../db/schema/index.js';
import { firstOrThrow } from './util.js';

/**
 * ledgerOpeningBalanceRepo — the append-only opening-balance store.
 *
 * WRITE MODEL: never UPDATE an amount. A change supersedes the live row (`superseded_at = now()`)
 * and inserts `revision + 1` pointing back through `supersedes_id`, both inside ONE transaction so
 * the partial unique index `ledger_opening_balances_live_uk` can never observe two live rows. Every
 * write path in this file — manual upsert, batch commit, revision revert, batch revert — is that same
 * supersede-then-insert operation, so history is complete by construction rather than by discipline.
 *
 * Reverting NEVER clears `superseded_at` on an old row. It writes a NEW revision carrying the old
 * values, so "we rolled back" is itself an auditable event rather than an erasure.
 *
 * NUMERIC round-trips as a string in Drizzle — `money()` formats every write at fixed scale and
 * `num()` parses every read. Precedent: ./paymentTransactionRepo.ts.
 */

/** NUMERIC → fixed-scale string. */
function money(n: number, scale = 2): string {
  return n.toFixed(scale);
}

/** NUMERIC (string) → number. */
export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface UpsertOpeningInput {
  carrierId: string;
  section: string;
  asOfDate: string;
  amount: number;
  source: LedgerOpeningSource;
  note?: string | null | undefined;
  importBatchId?: string | null | undefined;
  createdByUserId?: string | undefined;
  createdByName?: string | undefined;
  /**
   * Optimistic concurrency: the live revision id the caller was looking at. When supplied and the
   * live row has moved on, the write is refused rather than silently overwriting someone else's
   * correction — which for an opening balance would silently restate every downstream day.
   */
  expectedRevisionId?: string | null | undefined;
}

export interface UpsertOpeningResult {
  row: LedgerOpeningBalance;
  previous: LedgerOpeningBalance | null;
}

/** The gap report: how much of the launch migration is still outstanding, per section. */
export interface SectionCoverage {
  section: string;
  recorded: number;
}

async function liveFor(
  tx: DbOrTx,
  carrierId: string,
  section: string,
): Promise<LedgerOpeningBalance | undefined> {
  const rows = await tx
    .select()
    .from(ledgerOpeningBalances)
    .where(
      and(
        eq(ledgerOpeningBalances.carrierId, carrierId),
        eq(ledgerOpeningBalances.section, section),
        isNull(ledgerOpeningBalances.supersededAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Supersede the live row (if any) and insert the next revision. Shared by every write path so the
 * revision chain is maintained in exactly one place.
 */
async function supersedeAndInsert(
  tx: DbOrTx,
  input: UpsertOpeningInput,
): Promise<UpsertOpeningResult> {
  const carrierId = String(input.carrierId).trim();
  const section = String(input.section).trim();
  const previous = (await liveFor(tx, carrierId, section)) ?? null;

  if (input.expectedRevisionId !== undefined && input.expectedRevisionId !== null) {
    const liveId = previous?.id ?? null;
    if (liveId !== input.expectedRevisionId) {
      throw new ConflictError(
        'This opening balance changed since you loaded it — reload and re-apply your edit.',
        {
          code: 'LEDGER_OB_STALE',
          details: { carrierId, section, expected: input.expectedRevisionId, actual: liveId },
        },
      );
    }
  }

  if (previous) {
    await tx
      .update(ledgerOpeningBalances)
      .set({
        supersededAt: new Date(),
        supersededByName: input.createdByName ?? null,
      })
      .where(eq(ledgerOpeningBalances.id, previous.id));
  }

  const inserted = await tx
    .insert(ledgerOpeningBalances)
    .values({
      carrierId,
      section,
      asOfDate: input.asOfDate,
      amount: money(input.amount),
      source: input.source,
      note: input.note ?? null,
      importBatchId: input.importBatchId ?? null,
      revision: (previous?.revision ?? 0) + 1,
      supersedesId: previous?.id ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdByName: input.createdByName ?? null,
    })
    .returning();

  return { row: firstOrThrow(inserted, 'opening-balance insert returned no row'), previous };
}

export const ledgerOpeningBalanceRepo = {
  /** The live opening balance for one carrier+section. */
  async findLive(carrierId: string, section: string): Promise<LedgerOpeningBalance | undefined> {
    return liveFor(db, String(carrierId).trim(), String(section).trim());
  },

  /**
   * Live opening balances for many carriers, keyed `${carrierId}:${section}`. The compute layer calls
   * this ONCE for a whole page of carriers — never per carrier.
   */
  async findLiveBatch(
    carrierIds: readonly string[],
    sections?: readonly string[],
  ): Promise<Map<string, LedgerOpeningBalance>> {
    const ids = [...new Set(carrierIds.map((c) => String(c).trim()).filter(Boolean))];
    if (!ids.length) return new Map();
    const conds = [
      inArray(ledgerOpeningBalances.carrierId, ids),
      isNull(ledgerOpeningBalances.supersededAt),
    ];
    if (sections?.length) conds.push(inArray(ledgerOpeningBalances.section, [...sections]));
    const rows = await db
      .select()
      .from(ledgerOpeningBalances)
      .where(and(...conds));
    return new Map(rows.map((r) => [`${r.carrierId}:${r.section}`, r]));
  },

/**
   * Every LIVE opening balance for one section, unfiltered — keyed `${carrierId}:${section}`.
   *
   * The whole-book counterpart to `findLiveBatch`. There is at most one live row per carrier per
   * section, so this table stays small; passing 2,165 carrier ids to `findLiveBatch` instead builds an
   * `IN (...)` with 2,165 bind parameters and ships it to the database, which is what made the Ledger
   * tab time out against the managed instance. Keep `findLiveBatch` for genuinely small sets — the
   * import validator, a single carrier.
   */
  async findLiveBySection(section: string): Promise<Map<string, LedgerOpeningBalance>> {
    const rows = await db
      .select()
      .from(ledgerOpeningBalances)
      .where(
        and(
          eq(ledgerOpeningBalances.section, String(section).trim()),
          isNull(ledgerOpeningBalances.supersededAt),
        ),
      );
    return new Map(rows.map((r) => [`${r.carrierId}:${r.section}`, r]));
  },

  /**
   * Every live opening balance, paged. `ORDER BY` ends in `id` so offset paging cannot skip or repeat
   * a row when two rows share a carrier id.
   */
  async listLive(opts: {
    section?: string | undefined;
    carrierId?: string | undefined;
    limit: number;
    offset: number;
  }): Promise<{ rows: LedgerOpeningBalance[]; total: number }> {
    const conds = [isNull(ledgerOpeningBalances.supersededAt)];
    if (opts.section) conds.push(eq(ledgerOpeningBalances.section, opts.section));
    if (opts.carrierId) conds.push(eq(ledgerOpeningBalances.carrierId, String(opts.carrierId).trim()));
    const where = and(...conds);

    const [rows, counted] = await Promise.all([
      db
        .select()
        .from(ledgerOpeningBalances)
        .where(where)
        .orderBy(asc(ledgerOpeningBalances.carrierId), asc(ledgerOpeningBalances.section), asc(ledgerOpeningBalances.id))
        .limit(opts.limit)
        .offset(opts.offset),
      db.select({ n: sql<number>`count(*)::int` }).from(ledgerOpeningBalances).where(where),
    ]);
    return { rows, total: counted[0]?.n ?? 0 };
  },

  /** The full revision chain for one carrier (optionally one section), newest first. */
  async listHistory(carrierId: string, section?: string): Promise<LedgerOpeningBalance[]> {
    const conds = [eq(ledgerOpeningBalances.carrierId, String(carrierId).trim())];
    if (section) conds.push(eq(ledgerOpeningBalances.section, section));
    return db
      .select()
      .from(ledgerOpeningBalances)
      .where(and(...conds))
      .orderBy(desc(ledgerOpeningBalances.createdAt), desc(ledgerOpeningBalances.id));
  },

  async findById(id: string): Promise<LedgerOpeningBalance | undefined> {
    const rows = await db
      .select()
      .from(ledgerOpeningBalances)
      .where(eq(ledgerOpeningBalances.id, String(id).trim()))
      .limit(1);
    return rows[0];
  },

  /** Manual single-carrier write. Supersede + insert in one transaction. */
  async upsert(input: UpsertOpeningInput): Promise<UpsertOpeningResult> {
    return db.transaction(async (tx) => supersedeAndInsert(tx, input));
  },

  /**
   * Restore a superseded revision's values as a NEW revision. The old row keeps its
   * `superseded_at` — a revert is an event, not an erasure.
   */
  async revertToRevision(
    id: string,
    actor: { userId?: string | undefined; name?: string | undefined },
  ): Promise<UpsertOpeningResult> {
    return db.transaction(async (tx) => {
      const found = await tx
        .select()
        .from(ledgerOpeningBalances)
        .where(eq(ledgerOpeningBalances.id, String(id).trim()))
        .limit(1);
      const target = firstOrThrow(found, 'revision not found');
      return supersedeAndInsert(tx, {
        carrierId: target.carrierId,
        section: target.section,
        asOfDate: target.asOfDate,
        amount: num(target.amount),
        source: target.source,
        note: `Reverted to revision ${target.revision}${target.note ? ` — ${target.note}` : ''}`,
        createdByUserId: actor.userId,
        createdByName: actor.name,
      });
    });
  },

  /**
   * Apply a whole validated import in ONE transaction — either every accepted row lands or none does.
   * A half-applied opening-balance batch would leave the ledger internally inconsistent with no way to
   * tell which carriers were affected.
   *
   * `expectedRevisionId` on each row carries the preview's optimistic-concurrency check through to
   * commit, so a value someone edited between preview and commit aborts the batch instead of
   * clobbering their correction.
   */
  async commitBatch(
    rows: readonly UpsertOpeningInput[],
    batchId: string,
  ): Promise<{ committed: number; ids: string[] }> {
    if (!rows.length) return { committed: 0, ids: [] };
    return db.transaction(async (tx) => {
      const ids: string[] = [];
      for (const row of rows) {
        const result = await supersedeAndInsert(tx, { ...row, importBatchId: batchId });
        ids.push(result.row.id);
      }
      return { committed: ids.length, ids };
    });
  },

  /**
   * Undo a committed batch: for every revision the batch created that is STILL live, write a new
   * revision carrying the superseded predecessor's values (or, when the batch created the first
   * revision, a zero-amount row is NOT written — there is nothing to restore, so the batch row is
   * simply superseded and the carrier returns to having no opening balance).
   */
  async revertBatch(
    batchId: string,
    actor: { userId?: string | undefined; name?: string | undefined },
  ): Promise<{ reverted: number; cleared: number }> {
    return db.transaction(async (tx) => {
      const created = await tx
        .select()
        .from(ledgerOpeningBalances)
        .where(
          and(
            eq(ledgerOpeningBalances.importBatchId, String(batchId).trim()),
            isNull(ledgerOpeningBalances.supersededAt),
          ),
        );

      let reverted = 0;
      let cleared = 0;
      for (const row of created) {
        const priorRows = row.supersedesId
          ? await tx
              .select()
              .from(ledgerOpeningBalances)
              .where(eq(ledgerOpeningBalances.id, row.supersedesId))
              .limit(1)
          : [];
        const prior = priorRows[0];

        if (prior) {
          await supersedeAndInsert(tx, {
            carrierId: row.carrierId,
            section: row.section,
            asOfDate: prior.asOfDate,
            amount: num(prior.amount),
            source: prior.source,
            note: `Reverted import batch ${batchId}`,
            createdByUserId: actor.userId,
            createdByName: actor.name,
          });
          reverted += 1;
        } else {
          // The batch created this carrier's FIRST opening balance — reverting means having none
          // again, so supersede without a successor rather than inventing a zero.
          await tx
            .update(ledgerOpeningBalances)
            .set({ supersededAt: new Date(), supersededByName: actor.name ?? null })
            .where(eq(ledgerOpeningBalances.id, row.id));
          cleared += 1;
        }
      }
      return { reverted, cleared };
    });
  },

  /** How many carriers have a live opening balance per section — the migration progress bar. */
  async coverageBySection(): Promise<SectionCoverage[]> {
    const rows = await db
      .select({
        section: ledgerOpeningBalances.section,
        recorded: sql<number>`count(*)::int`,
      })
      .from(ledgerOpeningBalances)
      .where(isNull(ledgerOpeningBalances.supersededAt))
      .groupBy(ledgerOpeningBalances.section);
    return rows.map((r) => ({ section: r.section, recorded: r.recorded }));
  },

  /** Carrier ids that already have a live opening balance for a section (template `missing` filter). */
  async carrierIdsWithLive(section: string): Promise<Set<string>> {
    const rows = await db
      .select({ carrierId: ledgerOpeningBalances.carrierId })
      .from(ledgerOpeningBalances)
      .where(
        and(
          eq(ledgerOpeningBalances.section, String(section).trim()),
          isNull(ledgerOpeningBalances.supersededAt),
        ),
      );
    return new Set(rows.map((r) => r.carrierId));
  },
};
