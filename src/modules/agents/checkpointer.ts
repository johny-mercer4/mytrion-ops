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
let setupPromise: Promise<void> | null = null;

class PagedPostgresSaver extends PostgresSaver {
  // @ts-expect-error - Override getTuple to implement Context Paging (MemGPT standard)
  async getTuple(config: unknown) {
    const tuple = await super.getTuple(config as any);
    if (tuple?.checkpoint?.channel_values?.messages) {
      const msgs = tuple.checkpoint.channel_values.messages;
      if (Array.isArray(msgs) && msgs.length > 20) {
        // Keep the first message (system/initial brief) + last 19 messages
        tuple.checkpoint.channel_values.messages = [
          msgs[0],
          ...msgs.slice(-19),
        ];
      }
    }
    return tuple;
  }
}

function makeSaver(): PostgresSaver {
  // Own small pg pool (the checkpointer requires `pg`; the app pool is postgres.js) — max 5
  // keeps the combined footprint inside the managed-Postgres connection ceiling.
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: dbSslOption(databaseUrl),
  });
  return new PagedPostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
}

/** The process-wide checkpointer, or undefined when the flag is off. */
export function getCheckpointer(): PostgresSaver | undefined {
  if (!env.FF_AGENT_CHECKPOINTS) return undefined;
  if (!saver) saver = makeSaver();
  return saver;
}

/**
 * Ensure the `langgraph` schema tables exist before the first agent run uses them. setup() is
 * idempotent and memoized here, so this works whether or not scripts/migrate.ts ran (it is NOT
 * in the runtime image) — the orchestrator service calls this before building a checkpointed
 * agent. No-op when the flag is off.
 */
export async function ensureCheckpointerReady(): Promise<void> {
  if (!env.FF_AGENT_CHECKPOINTS) return;
  if (!setupPromise) {
    setupPromise = (saver ?? (saver = makeSaver())).setup().catch((err) => {
      setupPromise = null; // allow a retry on the next turn if setup transiently failed
      throw err;
    });
  }
  await setupPromise;
}

/** Create/upgrade the `langgraph` schema tables (also usable from scripts/migrate.ts). */
export async function setupCheckpointer(): Promise<void> {
  const s = saver ?? makeSaver();
  saver = s;
  await s.setup();
}

/** Durable thread id for a conversation. Tenant-prefixed so threads can never collide across tenants. */
export function threadIdFor(tenantId: string, conversationId: string): string {
  return `${tenantId}:${conversationId}`;
}
