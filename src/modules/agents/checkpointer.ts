/**
 * LangGraph Postgres checkpointer — durable orchestrator threads (FF_AGENT_CHECKPOINTS).
 * Lives in its own `langgraph` schema on the app database; the library owns that schema's DDL
 * (setup() is invoked from scripts/migrate.ts at release — never modeled in drizzle).
 *
 * TenantContext/secrets are NEVER checkpointed: state = messages/todos/files only. The ctx is
 * rebuilt per request and tools re-check RBAC live, so resuming a thread under a downgraded
 * caller is safe.
 *
 * Context paging (MemGPT): when mid-history exceeds AGENT_CONTEXT_PAGE_CHARS, evicted turns are
 * condensed into a structured memorySummary and re-injected as <MemorySummary> on read.
 */
import pg from 'pg';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { SystemMessage } from '@langchain/core/messages';
import { databaseUrl, env } from '../../config/env.js';
import { dbSslOption } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

export const CHECKPOINT_SCHEMA = 'langgraph';

let saver: PostgresSaver | null = null;
let setupPromise: Promise<void> | null = null;

/** Structured running summary stored in checkpoint channel_values.memorySummary. */
export interface MemorySummaryPayload {
  goal: string;
  entities: string[];
  openTasks: string[];
  decisions: string[];
  narrative: string;
}

export function parseMemorySummary(raw: unknown): MemorySummaryPayload | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MemorySummaryPayload>;
    if (typeof parsed.narrative !== 'string' && typeof parsed.goal !== 'string') {
      // Legacy free-text summaries from before structured compaction.
      return { goal: '', entities: [], openTasks: [], decisions: [], narrative: raw };
    }
    return {
      goal: typeof parsed.goal === 'string' ? parsed.goal : '',
      entities: Array.isArray(parsed.entities) ? parsed.entities.map(String).slice(0, 40) : [],
      openTasks: Array.isArray(parsed.openTasks) ? parsed.openTasks.map(String).slice(0, 20) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(String).slice(0, 20) : [],
      narrative: typeof parsed.narrative === 'string' ? parsed.narrative : raw,
    };
  } catch {
    return { goal: '', entities: [], openTasks: [], decisions: [], narrative: raw };
  }
}

export function formatMemorySummaryXml(summary: MemorySummaryPayload): string {
  const lines = ['<MemorySummary>'];
  if (summary.goal) lines.push(`  <Goal>${summary.goal}</Goal>`);
  if (summary.entities.length) lines.push(`  <Entities>${summary.entities.join('; ')}</Entities>`);
  if (summary.openTasks.length) lines.push(`  <OpenTasks>${summary.openTasks.join('; ')}</OpenTasks>`);
  if (summary.decisions.length) lines.push(`  <Decisions>${summary.decisions.join('; ')}</Decisions>`);
  if (summary.narrative) lines.push(`  <Narrative>${summary.narrative}</Narrative>`);
  lines.push('</MemorySummary>');
  return lines.join('\n');
}

function messageText(m: { getType?: () => string; type?: string; content?: unknown; data?: { content?: unknown } }): string {
  const role = m.getType ? m.getType() : m.type || 'unknown';
  const content = m.content ?? m.data?.content ?? '';
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  return `${role}: ${body}`;
}

/** Char length of message bodies in [start, end) — used for token-budget paging heuristics. */
export function midHistoryChars(msgs: unknown[], keepRecent: number): number {
  if (!Array.isArray(msgs) || msgs.length <= keepRecent + 1) return 0;
  const mid = msgs.slice(1, -keepRecent);
  return mid.reduce((sum: number, m) => sum + messageText(m as Parameters<typeof messageText>[0]).length, 0);
}

export function needsPaging(msgs: unknown[], pageChars = env.AGENT_CONTEXT_PAGE_CHARS, keepRecent = env.AGENT_CONTEXT_KEEP_RECENT): boolean {
  return midHistoryChars(msgs, keepRecent) > pageChars;
}

function pageMessages(msgs: unknown[], summaryRaw: unknown, keepRecent: number): unknown[] {
  const summary = parseMemorySummary(summaryRaw);
  const summaryMsg = summary ? new SystemMessage(formatMemorySummaryXml(summary)) : null;
  if (msgs.length > keepRecent + 1) {
    return [msgs[0], ...(summaryMsg ? [summaryMsg] : []), ...msgs.slice(-keepRecent)];
  }
  if (summaryMsg && msgs.length > 1) {
    return [msgs[0], summaryMsg, ...msgs.slice(1)];
  }
  return msgs;
}

class PagedPostgresSaver extends PostgresSaver {
  // @ts-expect-error - Override getTuple to implement Context Paging (MemGPT standard)
  async getTuple(config: unknown) {
    const tuple = await super.getTuple(config as never);
    try {
      if (tuple?.checkpoint?.channel_values?.messages) {
        const msgs = tuple.checkpoint.channel_values.messages;
        const summary = tuple.checkpoint.channel_values.memorySummary;
        if (Array.isArray(msgs)) {
          const keepRecent = env.AGENT_CONTEXT_KEEP_RECENT;
          if (needsPaging(msgs) || summary) {
            tuple.checkpoint.channel_values.messages = pageMessages(msgs, summary, keepRecent);
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'checkpointer getTuple paging failed; returning raw tuple');
    }
    return tuple;
  }

  // @ts-expect-error - Override put to intercept and summarize evicted messages
  async put(config: unknown, checkpoint: { channel_values?: Record<string, unknown> }, metadata: unknown, newVersions: unknown) {
    try {
      const msgs = checkpoint?.channel_values?.messages;
      if (Array.isArray(msgs) && needsPaging(msgs)) {
        const keepRecent = env.AGENT_CONTEXT_KEEP_RECENT;
        const evicted = msgs.slice(1, -keepRecent);
        const { resolveOrchestratorModel } = await import('./models.js');
        const model = resolveOrchestratorModel();
        const contentToSummarize = evicted
          .map((m) => messageText(m as Parameters<typeof messageText>[0]))
          .join('\n\n')
          .slice(0, 24_000);
        const prev = parseMemorySummary(checkpoint.channel_values?.memorySummary);
        const prevBlock = prev
          ? JSON.stringify(prev)
          : String(checkpoint.channel_values?.memorySummary ?? '');
        const res = await model.invoke([
          new SystemMessage(
            'You are a memory condensation module. Return ONLY valid JSON with keys: ' +
              'goal (string), entities (string[]), openTasks (string[]), decisions (string[]), narrative (string). ' +
              'Retain critical entities, IDs, facts, open work, and the overarching user goal. ' +
              'Merge with Previous Summary when provided. Be concise.',
          ),
          {
            role: 'user',
            content: `Previous Summary:\n${prevBlock}\n\nNew Evicted Messages:\n${contentToSummarize}`,
          },
        ]);
        const raw = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
        const structured = parseMemorySummary(raw);
        const channels = checkpoint.channel_values;
        if (structured && channels) {
          // Prefer model JSON when parseable; otherwise wrap free text.
          try {
            JSON.parse(raw);
            channels.memorySummary = JSON.stringify(structured);
          } catch {
            channels.memorySummary = JSON.stringify({
              ...structured,
              narrative: raw.slice(0, 4000),
            });
          }
        }
      }
    } catch (err) {
      const threadId =
        typeof config === 'object' && config && 'configurable' in config
          ? (config as { configurable?: { thread_id?: string } }).configurable?.thread_id
          : undefined;
      logger.warn({ err, threadId }, 'Failed to summarize memory during checkpoint put');
    }
    return super.put(config as never, checkpoint as never, metadata as never, newVersions as never);
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
