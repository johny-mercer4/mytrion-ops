/**
 * Persisted shapes for a bulk opening-balance import.
 *
 * Kept in its own type-only module (no runtime imports) so `src/db/schema/ledger_import_batches.ts`
 * can `import type` it without pulling module code into drizzle-kit's loader — the constraint the
 * comment at the top of drizzle.config.ts explains.
 *
 * These rows are written into `ledger_import_batches.validation` at PREVIEW time and read back
 * verbatim at COMMIT time, so commit is a pure function of what the agent actually reviewed. That
 * makes this a stored format: adding a field is fine, changing the meaning of one is a migration.
 */
import type { LedgerSectionId } from './sections.js';

/** Whether the row can be written. `unchanged` is accepted-but-a-no-op, shown separately. */
export type LedgerImportVerdict = 'accept' | 'reject' | 'unchanged';

/** How the row would move the live value — drives the preview's "will change" count and the ack gate. */
export type LedgerImportChangeKind = 'new' | 'changed' | 'unchanged';

export interface LedgerImportPreviewRow {
  /** 1-based SPREADSHEET row number, so an error message can say "fix row 47". */
  rowNumber: number;
  carrierId: string;
  companyName: string;
  /** Empty when the carrier could not be resolved. */
  clientType: 'LOC' | 'Prepay' | '';
  section: LedgerSectionId | '';
  asOfDate: string;
  amount: number | null;
  note: string | null;

  verdict: LedgerImportVerdict;
  changeKind: LedgerImportChangeKind;
  /**
   * EVERY reason the row was rejected, not just the first — a row can fail two ways at once, and
   * surfacing one at a time costs the agent an extra upload cycle per fault.
   */
  reasons: string[];

  /** The live amount at preview time; null when no opening balance exists yet. */
  previousAmount: number | null;
  previousAsOfDate: string | null;
  /** The live revision id at preview time — commit refuses if it has moved since. */
  previousRevisionId: string | null;
  /** `amount − previousAmount`, or null when there is nothing to compare. */
  delta: number | null;
}

export interface LedgerImportSummary {
  rowCount: number;
  accepted: number;
  rejected: number;
  changed: number;
  new: number;
  unchanged: number;
}
