/**
 * SQL vendor base. Two things the HTTP base can't express are load-bearing here:
 *  - `placeholderStyle`: Postgres `$1` vs MySQL `?` — queries are NOT portable between the
 *    two SQL wrappers, and the property makes a wrapper's dialect visible at the call site.
 *  - `readOnly`: documents (and the implementations enforce, at the session level) that the
 *    external analytics/CMP databases are never written by this codebase (repo rule 7).
 *
 * The INTERNAL app Postgres is deliberately NOT a SqlWrapper — repo rule 2 routes every
 * internal query through repos/; its wrapper (internalDb.ts) is health-only.
 */
import { BaseWrapper } from './base.js';

export abstract class SqlWrapper extends BaseWrapper {
  readonly kind = 'sql' as const;
  /** '$n' (Postgres) or '?' (MySQL) — the two are not interchangeable. */
  abstract readonly placeholderStyle: '$n' | '?';
  /** True when the session pins read-only (the default posture for external DBs). */
  abstract readonly readOnly: boolean;
  abstract query<T extends object = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  /** Close the underlying pool (graceful shutdown / tests). */
  abstract close(): Promise<void>;
}
