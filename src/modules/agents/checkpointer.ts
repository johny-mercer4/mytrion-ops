/**
 * LangGraph Postgres checkpointer — durable orchestrator threads (FF_AGENT_CHECKPOINTS).
 * Lives in its own `langgraph` schema on the app database; the library owns that schema's DDL
 * (setup() is invoked from scripts/migrate.ts at release — never modeled in drizzle).
 *
 * TenantContext/secrets are NEVER checkpointed: state = messages/todos/files only. The ctx is
 * rebuilt per request and tools re-check RBAC live, so resuming a thread under a downgraded
 * caller is safe.
 */
import pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { databaseUrl, env } from '../../config/env.js';
import { dbSslOption } from '../../db/client.js';

export const CHECKPOINT_SCHEMA = 'langgraph';

let saver: PostgresSaver | null = null;

function makeSaver(): PostgresSaver {
  // Own small pg pool (the checkpointer requires `pg`; the app pool is postgres.js) — max 5
  // keeps the combined footprint inside the managed-Postgres connection ceiling.
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: dbSslOption(databaseUrl),
  });
  return new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
}

/** The process-wide checkpointer, or undefined when the flag is off. */
export function getCheckpointer(): PostgresSaver | undefined {
  if (!env.FF_AGENT_CHECKPOINTS) return undefined;
  if (!saver) saver = makeSaver();
  return saver;
}

/** Create/upgrade the `langgraph` schema tables. Called from scripts/migrate.ts. */
export async function setupCheckpointer(): Promise<void> {
  const s = saver ?? makeSaver();
  saver = s;
  await s.setup();
}

/** Durable thread id for a conversation. Tenant-prefixed so threads can never collide across tenants. */
export function threadIdFor(tenantId: string, conversationId: string): string {
  return `${tenantId}:${conversationId}`;
}
