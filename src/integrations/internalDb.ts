/**
 * Internal Postgres wrapper — HEALTH-ONLY by design. Repo hard-rule 2 routes every internal
 * DB query through repos/ (which enforce tenant_id isolation), so this wrapper deliberately
 * exposes NO query surface: it only adapts db/client.ts for the health registry and graceful
 * shutdown. Do not add a query() here.
 */
import { closeDb, pingDb } from '../db/client.js';
import { databaseUrl } from '../config/env.js';
import { BaseWrapper } from './core/base.js';

export class InternalDbWrapper extends BaseWrapper {
  readonly name = 'internal_db';
  readonly kind = 'sql' as const;

  isConfigured(): boolean {
    return Boolean(databaseUrl);
  }

  protected override async probe(): Promise<void> {
    await pingDb();
  }

  close(): Promise<void> {
    return closeDb();
  }
}

export const internalDb = new InternalDbWrapper();
