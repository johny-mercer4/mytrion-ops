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
import { SystemMessage } from '@langchain/core/messages';

export const CHECKPOINT_SCHEMA = 'langgraph';

let saver: PostgresSaver | null = null;
let setupPromise: Promise<void> | null = null;

class PagedPostgresSaver extends PostgresSaver {
  // @ts-expect-error - Override getTuple to implement Context Paging (MemGPT standard)
  async getTuple(config: unknown) {
    const tuple = await super.getTuple(config as any);
    if (tuple?.checkpoint?.channel_values?.messages) {
      const msgs = tuple.checkpoint.channel_values.messages;
      const summary = tuple.checkpoint.channel_values.memorySummary;
      if (Array.isArray(msgs) && msgs.length > 20) {
        // Keep the first message (system/initial brief) + last 19 messages + inject summary
        tuple.checkpoint.channel_values.messages = [
          msgs[0],
          ...(summary ? [new SystemMessage(`<MemorySummary>\n${summary}\n</MemorySummary>`)] : []),
          ...msgs.slice(-19),
        ];
      } else if (summary && Array.isArray(msgs) && msgs.length > 1) {
        tuple.checkpoint.channel_values.messages = [
          msgs[0],
          new SystemMessage(`<MemorySummary>\n${summary}\n</MemorySummary>`),
          ...msgs.slice(1),
        ];
      }
    }
    return tuple;
  }

  // @ts-expect-error - Override put to intercept and summarize evicted messages
  async put(config: any, checkpoint: any, metadata: any, newVersions: any) {
    if (checkpoint?.channel_values?.messages) {
      const msgs = checkpoint.channel_values.messages;
      if (Array.isArray(msgs) && msgs.length > 20) {
        const evicted = msgs.slice(1, -19);
        try {
          const { resolveOrchestratorModel } = await import('./models.js');
          const model = resolveOrchestratorModel();
          const contentToSummarize = evicted
            .map((m: any) => {
              const role = m.getType ? m.getType() : m.type || 'unknown';
              const content = m.content || m.data?.content || '';
              return `${role}: ${typeof content === 'string' ? content : JSON.stringify(content)}`;
            })
            .join('\n\n');
          const prevSummary = checkpoint.channel_values.memorySummary || '';
          const res = await model.invoke([
            new SystemMessage('You are a memory condensation module. Summarize the following evicted conversation messages into a highly concise running summary. Retain the most critical entities, facts, state variables, and task progression. Combine this logically with the previous summary if provided.'),
            { role: 'user', content: `Previous Summary:\n${prevSummary}\n\nNew Evicted Messages:\n${contentToSummarize}` }
          ]);
          checkpoint.channel_values.memorySummary = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
        } catch (err) {
          console.error("Failed to summarize memory", err);
        }
      }
    }
    return super.put(config, checkpoint, metadata, newVersions);
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
