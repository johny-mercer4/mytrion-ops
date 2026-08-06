import { AppError } from '../../../lib/errors.js';
import { ledgerReadinessRepo, type LedgerSchemaReadiness } from '../../../repos/ledgerReadinessRepo.js';

/**
 * 30s-TTL cached readiness gate for the ledger route prefix. Without it, a deploy that reaches the
 * app before `0104_ledger_core` is applied turns every ledger request into an opaque 500 instead of
 * a 503 that names the missing tables. Mirrors ../../comms/readiness.ts.
 */
const READINESS_TTL_MS = 30_000;
let cached: { value: LedgerSchemaReadiness; at: number } | null = null;
let inflight: Promise<LedgerSchemaReadiness> | null = null;

export async function getLedgerSchemaReadiness(force = false): Promise<LedgerSchemaReadiness> {
  if (!force && cached && Date.now() - cached.at < READINESS_TTL_MS) return cached.value;
  if (inflight) return inflight;
  inflight = ledgerReadinessRepo
    .check()
    .then((value) => {
      cached = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function requireLedgerSchema(): Promise<void> {
  const readiness = await getLedgerSchemaReadiness();
  if (readiness.ready) return;
  throw new AppError('The Billing Ledger is temporarily unavailable while it is being set up.', {
    statusCode: 503,
    code: 'LEDGER_SCHEMA_NOT_READY',
    expose: true,
    details: { missingTables: readiness.missing },
  });
}

export function clearLedgerReadinessCache(): void {
  cached = null;
}
