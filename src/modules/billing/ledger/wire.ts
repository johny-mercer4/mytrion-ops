/**
 * Drizzle row → frontend wire shape for the Billing Ledger.
 *
 * Mirrors ../wire.ts (the Transactions/Returns mapper). Two jobs, both load-bearing:
 *   • NUMERIC arrives from Drizzle as a STRING — every money field is parsed to a number here so no
 *     route hands the frontend `"1600.00"` where it expects `1600`.
 *   • camelCase field names, and `companyName` attached from the resolved carrier rather than
 *     denormalized onto the row (the carrier master lives in the DWH, not our Postgres).
 */
import type {
  LedgerClientTypeOverride,
  LedgerOpeningBalance,
} from '../../../db/schema/index.js';
import { num } from '../../../repos/ledgerOpeningBalanceRepo.js';
import type { LedgerCarrier } from './clientType.js';
import type { LedgerSectionId } from './sections.js';

export interface OpeningBalanceWire {
  id: string;
  carrierId: string;
  companyName: string | null;
  clientType: string | null;
  section: LedgerSectionId;
  asOfDate: string;
  amount: number;
  currency: string;
  source: string;
  note: string | null;
  importBatchId: string | null;
  revision: number;
  supersedesId: string | null;
  /** null ⇒ this is the live revision. */
  supersededAt: string | null;
  supersededByName: string | null;
  createdByName: string | null;
  createdAt: string;
}

export function toOpeningWire(
  row: LedgerOpeningBalance,
  carrier?: LedgerCarrier | undefined,
): OpeningBalanceWire {
  return {
    id: row.id,
    carrierId: row.carrierId,
    companyName: carrier?.companyName ?? null,
    clientType: carrier?.clientType ?? null,
    section: row.section as LedgerSectionId,
    asOfDate: row.asOfDate,
    amount: num(row.amount),
    currency: row.currency,
    source: row.source,
    note: row.note,
    importBatchId: row.importBatchId,
    revision: row.revision,
    supersedesId: row.supersedesId,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    supersededByName: row.supersededByName,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ClientTypeOverrideWire {
  id: string;
  carrierId: string;
  clientType: string;
  effectiveFrom: string;
  /** null ⇒ still open / current. */
  effectiveTo: string | null;
  reason: string;
  dwhValueAtWrite: string | null;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
}

export function toOverrideWire(row: LedgerClientTypeOverride): ClientTypeOverrideWire {
  return {
    id: row.id,
    carrierId: row.carrierId,
    clientType: row.clientType,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    reason: row.reason,
    dwhValueAtWrite: row.dwhValueAtWrite,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closedByName: row.closedByName,
  };
}
