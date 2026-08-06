/**
 * Schema-readiness probe for the Billing Ledger.
 *
 * Reads PostgreSQL catalog metadata only; no rows are selected. Keeping the query in a repo
 * preserves the repository boundary (CLAUDE.md rule 2) while letting the route prefix answer 503
 * with the missing table names instead of an opaque table-not-found 500 — which is what a deploy
 * that lands before `0104_ledger_core` would otherwise produce on every ledger request.
 *
 * Mirrors ./commsReadinessRepo.ts.
 */
import { pg } from '../db/client.js';

export interface LedgerSchemaReadiness {
  ready: boolean;
  missing: string[];
}

interface ReadinessRow {
  openingBalances: string | null;
  clientTypeOverrides: string | null;
  importBatches: string | null;
}

const REQUIRED = [
  ['openingBalances', 'ledger_opening_balances'],
  ['clientTypeOverrides', 'ledger_client_type_overrides'],
  ['importBatches', 'ledger_import_batches'],
] as const;

export const ledgerReadinessRepo = {
  async check(): Promise<LedgerSchemaReadiness> {
    const [row] = await pg<ReadinessRow[]>`
      select
        to_regclass('public.ledger_opening_balances')::text      as "openingBalances",
        to_regclass('public.ledger_client_type_overrides')::text as "clientTypeOverrides",
        to_regclass('public.ledger_import_batches')::text        as "importBatches"
    `;
    const missing = REQUIRED.filter(([field]) => !row?.[field]).map(([, table]) => table);
    return { ready: missing.length === 0, missing };
  },
};
