/**
 * The desk-owned columns on a collection case — agency handling, the legal block, what a human
 * verified about the debtor, escalation, disposition, and who owns the case.
 *
 * Separate from `collectionCaseRepo` for two reasons. That file is the read model plus the
 * lifecycle writes (stage, close, reopen, placement) and is already near the size cap; and
 * everything here is a plain field edit that the finder never touches, so it wants a different
 * shape from the lifecycle moves — one patch, one audit line, no side effects on stage.
 *
 * WHY A WHITELIST RATHER THAN A SPREAD. The route hands over a parsed body; spreading it into the
 * update would let any column the schema happens to expose be written from the wire, including
 * the finder-owned money fields. `FIELD_COLUMNS` names exactly what a human may edit, so adding a
 * writable field is a deliberate line in this file rather than an accident in a zod schema.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collectionCases, type CollectionLossReason } from '../db/schema/collection.js';
import { toCollectionCaseDto, type CollectionCaseDto } from './collectionCaseRepo.js';

export interface CaseFieldPatch {
  // Agency
  currentAgency?: string | null;
  secondCollectionAgency?: string | null;
  caineWeinerTier?: string | null;
  agencyResponseStatus?: string | null;
  agencyTransferDate?: string | null;
  // Legal
  legalActionRequired?: boolean;
  courtType?: string | null;
  legalFilingDate?: string | null;
  legalDocumentsAttached?: boolean;
  courtStatus?: string | null;
  // Locating the debtor, and what a human confirmed
  skipTraceRequired?: boolean;
  verifiedEmail?: string | null;
  verifiedPhone?: string | null;
  verifiedAddress?: string | null;
  // Escalation
  escalationRequired?: boolean;
  escalationDate?: string | null;
  // Disposition
  cooperationStatus?: string | null;
  lossReason?: CollectionLossReason | null;
  paymentReceived?: boolean;
  paymentReceivedDate?: string | null;
  // Flags and cost
  reminderCycleActive?: boolean;
  earlyBadDebtorFlag?: boolean;
  totalCostIncurred?: string;
}

/** Every column a human is allowed to edit, and the only ones `patch` will write. */
export const FIELD_COLUMNS = [
  'currentAgency',
  'secondCollectionAgency',
  'caineWeinerTier',
  'agencyResponseStatus',
  'agencyTransferDate',
  'legalActionRequired',
  'courtType',
  'legalFilingDate',
  'legalDocumentsAttached',
  'courtStatus',
  'skipTraceRequired',
  'verifiedEmail',
  'verifiedPhone',
  'verifiedAddress',
  'escalationRequired',
  'escalationDate',
  'cooperationStatus',
  'lossReason',
  'paymentReceived',
  'paymentReceivedDate',
  'reminderCycleActive',
  'earlyBadDebtorFlag',
  'totalCostIncurred',
] as const satisfies readonly (keyof CaseFieldPatch)[];

/** The keys the caller actually set, so the timeline can name what changed. */
export function changedFields(patch: CaseFieldPatch): string[] {
  return FIELD_COLUMNS.filter((k) => patch[k] !== undefined);
}

export const collectionCaseFieldsRepo = {
  /**
   * Apply a field patch. Returns undefined when the case is gone, and the unchanged row when the
   * patch is empty — an empty PATCH is a no-op, not an error, so a form that submits with nothing
   * touched does not fail in the user's face.
   */
  async patch(id: string, patch: CaseFieldPatch): Promise<CollectionCaseDto | undefined> {
    const set: Record<string, unknown> = {};
    for (const key of FIELD_COLUMNS) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (Object.keys(set).length === 0) {
      const rows = await db.select().from(collectionCases).where(eq(collectionCases.id, id)).limit(1);
      const row = rows[0];
      return row ? toCollectionCaseDto(row) : undefined;
    }
    set['updatedAt'] = new Date();
    const rows = await db
      .update(collectionCases)
      .set(set)
      .where(eq(collectionCases.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionCaseDto(row) : undefined;
  },

  /**
   * Give the case to somebody. The display name is stored alongside the id so a list row renders
   * without a join — the desk lists hundreds of cases and the owner column is on every one.
   */
  async assign(
    id: string,
    input: { userId: string; name: string | null },
  ): Promise<CollectionCaseDto | undefined> {
    const rows = await db
      .update(collectionCases)
      .set({
        assigneeUserId: input.userId,
        assigneeName: input.name,
        assignedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(collectionCases.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionCaseDto(row) : undefined;
  },

  /** Put the case back in the unassigned pool. `assigned_at` clears with it. */
  async unassign(id: string): Promise<CollectionCaseDto | undefined> {
    const rows = await db
      .update(collectionCases)
      .set({ assigneeUserId: null, assigneeName: null, assignedAt: null, updatedAt: new Date() })
      .where(eq(collectionCases.id, id))
      .returning();
    const row = rows[0];
    return row ? toCollectionCaseDto(row) : undefined;
  },
};
