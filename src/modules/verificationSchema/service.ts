/**
 * Verification DB schema introspection — a read-only, live view of the `credit_platform` Render
 * Postgres (`verificationDb`, integrations/verificationDb.ts) for the Mytrion Admin "Verification
 * DB" developer tab, so we can reference its tables/columns/relationships (and see how recently
 * each was written) while building the Sales Mytrion verification pipeline.
 *
 * Uses the shared pg_catalog introspector (identical snapshot shape as the DWH tab), then ENRICHES
 * `updateTime` from the newest value of each table's conventional timestamp column
 * (updated_at/created_at/…). credit_platform's pg_stat counters are reset (all null), so the
 * vacuum/analyze proxy the DWH relies on is blank here — the timestamp-column max is the real
 * "updated regularly?" signal. Only reads a MAX() aggregate over a timestamp column — never rows.
 */
import { verificationDb } from '../../integrations/verificationDb.js';
import { AppError } from '../../lib/errors.js';
import { introspectPgSchema, type PgSchemaSnapshot } from '../dbSchema/pgIntrospect.js';

export type VerificationSchemaSnapshot = PgSchemaSnapshot;

/** Preferred "last write" column names, best first. Only used when the column is a timestamp type. */
const FRESHNESS_COLS = ['updated_at', 'modified_at', 'created_at', 'inserted_at', 'event_time', 'occurred_at'];
const TS_TYPES = new Set(['timestamptz', 'timestamp']);

/** Double-quote a Postgres identifier (catalog-sourced, but quote+escape defensively). */
function q(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

/**
 * Replace each base table's `updateTime` with MAX(<timestamp column>) when the table has a
 * conventional timestamp column — a real "last written" time. Best-effort per table (a failure or
 * a table with no such column keeps the base value). Views/matviews are skipped.
 */
async function enrichFreshness(snap: VerificationSchemaSnapshot): Promise<void> {
  const targets = snap.tables
    .filter((t) => t.type === 'BASE TABLE')
    .map((t) => {
      const col = FRESHNESS_COLS.map((name) => t.columns.find((c) => c.name === name && TS_TYPES.has(c.dataType))).find(
        Boolean,
      );
      return col ? { table: t, col: col.name } : null;
    })
    .filter((x): x is { table: (typeof snap.tables)[number]; col: string } => x !== null);

  await Promise.all(
    targets.map(async ({ table, col }) => {
      try {
        const rows = await verificationDb.query<{ m: string | null }>(
          `SELECT MAX(${q(col)})::text AS m FROM ${q(table.schema)}.${q(table.name)}`,
        );
        const m = rows[0]?.m;
        if (m) {
          const d = new Date(m);
          if (!Number.isNaN(d.getTime())) table.updateTime = d.toISOString();
        }
      } catch {
        /* keep the base updateTime — a permission/type edge shouldn't fail the whole snapshot */
      }
    }),
  );
}

export async function getVerificationSchema(): Promise<VerificationSchemaSnapshot> {
  if (!verificationDb.isConfigured()) {
    throw new AppError('Verification DB is not configured.', {
      statusCode: 503,
      code: 'VERIFICATION_DB_UNCONFIGURED',
    });
  }
  const snap = await introspectPgSchema(verificationDb, 'credit_platform');
  await enrichFreshness(snap);
  return snap;
}
