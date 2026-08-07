/**
 * Latency + quality baseline for Horizon's Sales self-knowledge answers.
 *
 * Posts a fixed question set at /v1/agent, then reads the telemetry the run already writes —
 * `rag_runs` (route/grade/confidence/hops/candidates/duration) and `llm_calls` (per-role model,
 * latency, ttft, tokens, cost) — and prints one line per stage so a change can be compared as
 * numbers instead of by feel.
 *
 * Usage:
 *   BENCH_API=http://localhost:3011 \
 *   MYTRION_OPS_DATABASE_URL=postgresql://octane:octane@localhost:5433/octane_assistant \
 *   pnpm tsx scripts/benchSalesChat.ts [--json]
 *
 * Point it at a LOCAL database. The Render instance drops connections mid-run, which corrupts
 * exactly the timings this script exists to measure.
 */
import 'dotenv/config';
import { closeDb } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { db } from '../src/db/client.js';
import { llmCalls } from '../src/db/schema/llm_calls.js';
import { ragRuns } from '../src/db/schema/rag_runs.js';
import { and, eq } from 'drizzle-orm';

interface BenchCase {
  id: string;
  question: string;
  /** Substring expected in a winning citation title — the quality half of the measurement. */
  expectDoc: string;
  /** Tools that must NOT be called: a documented how-to needs no live data. */
  forbidTools: string[];
}

const CASES: readonly BenchCase[] = [
  {
    id: 'card-activation',
    question: 'How do I activate a card in Sales Mytrion?',
    expectDoc: 'Card Activation',
    forbidTools: ['zoho_crm.query', 'zoho_crm.search', 'warehouse.my_gallons'],
  },
  {
    id: 'retention-generation',
    question: 'How are Retention cases generated in Sales Mytrion?',
    expectDoc: 'Retention',
    forbidTools: ['zoho_crm.query', 'warehouse.my_gallons'],
  },
  {
    id: 'open-pool-claim',
    question: 'How do I claim a case from the Open Pool?',
    expectDoc: 'Retention',
    forbidTools: ['zoho_crm.query', 'warehouse.my_gallons'],
  },
  {
    id: 'limit-max',
    question: 'What is the maximum limit change per run in Automations?',
    expectDoc: 'Limits',
    forbidTools: ['zoho_crm.query', 'warehouse.my_gallons'],
  },
] as const;

interface AgentResponse {
  conversationId?: string;
  message?: string;
  toolCalls?: Array<{ name: string; status: string }>;
  citations?: Array<{ id: string; title?: string; marker?: string }>;
  ragPassages?: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalCost?: number };
  error?: { message?: string; retryable?: boolean };
}

const API = process.env['BENCH_API'] ?? 'http://localhost:3011';
const AS_JSON = process.argv.includes('--json');

async function ask(bench: BenchCase): Promise<{ res: AgentResponse; wallMs: number }> {
  const startedAt = Date.now();
  const response = await fetch(`${API}/v1/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.API_KEY },
    body: JSON.stringify({
      message: bench.question,
      agent: 'sales',
      zoho_user_id: '42',
      user_name: 'Bench Admin',
      profile: 'Administrator',
    }),
  });
  const res = (await response.json()) as AgentResponse;
  return { res, wallMs: Date.now() - startedAt };
}

async function telemetryFor(conversationId: string) {
  const [rag, llm] = await Promise.all([
    db
      .select()
      .from(ragRuns)
      .where(and(eq(ragRuns.tenantId, 'octane'), eq(ragRuns.conversationId, conversationId))),
    db
      .select()
      .from(llmCalls)
      .where(and(eq(llmCalls.tenantId, 'octane'), eq(llmCalls.conversationId, conversationId))),
  ]);
  return { rag, llm };
}

interface Row {
  id: string;
  wallMs: number;
  failed: boolean;
  citedExpected: boolean;
  citations: string[];
  toolCalls: string[];
  forbiddenCalled: string[];
  ragRuns: number;
  grades: string[];
  hops: number;
  ragMs: number;
  llmCalls: number;
  llmByRole: string[];
  llmMs: number;
  costUsd: number;
}

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (const bench of CASES) {
    const { res, wallMs } = await ask(bench);
    const conversationId = res.conversationId ?? '';
    const { rag, llm } = conversationId
      ? await telemetryFor(conversationId)
      : { rag: [], llm: [] };
    const toolCalls = (res.toolCalls ?? []).map((t) => t.name);
    const citations = (res.citations ?? []).map((c) => c.title ?? c.id);

    rows.push({
      id: bench.id,
      wallMs,
      failed: Boolean(res.error),
      citedExpected: citations.some((t) => t.includes(bench.expectDoc)),
      citations: [...new Set(citations)],
      toolCalls,
      forbiddenCalled: toolCalls.filter((name) => bench.forbidTools.includes(name)),
      ragRuns: rag.length,
      grades: rag.map((r) => `${r.grade}/${Number(r.confidence).toFixed(2)}`),
      hops: rag.reduce((sum, r) => sum + (r.hops ?? 0), 0),
      ragMs: rag.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
      llmCalls: llm.length,
      llmByRole: llm.map((c) => `${c.role}:${c.model}:${c.latencyMs ?? 0}ms`),
      llmMs: llm.reduce((sum, c) => sum + (c.latencyMs ?? 0), 0),
      costUsd: llm.reduce((sum, c) => sum + Number(c.estimatedCost ?? 0), 0),
    });
  }

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  const pad = (s: string, n: number): string => s.padEnd(n);
  process.stdout.write(
    `\n${pad('case', 22)}${pad('wall', 9)}${pad('llm', 6)}${pad('llmMs', 8)}${pad('rag', 5)}${pad('ragMs', 8)}${pad('hops', 6)}${pad('tools', 7)}${pad('cited?', 8)}bad\n`,
  );
  process.stdout.write(`${'-'.repeat(96)}\n`);
  for (const r of rows) {
    process.stdout.write(
      pad(r.id, 22) +
        pad(`${r.wallMs}ms`, 9) +
        pad(String(r.llmCalls), 6) +
        pad(`${r.llmMs}ms`, 8) +
        pad(String(r.ragRuns), 5) +
        pad(`${r.ragMs}ms`, 8) +
        pad(String(r.hops), 6) +
        pad(String(r.toolCalls.length), 7) +
        pad(r.failed ? 'FAILED' : r.citedExpected ? 'yes' : 'NO', 8) +
        (r.forbiddenCalled.length > 0 ? r.forbiddenCalled.join(',') : '-') +
        '\n',
    );
  }
  const total = rows.reduce((s, r) => s + r.wallMs, 0);
  const cost = rows.reduce((s, r) => s + r.costUsd, 0);
  process.stdout.write(
    `\ntotal wall ${total}ms  ·  mean ${Math.round(total / rows.length)}ms  ·  ` +
      `llm calls ${rows.reduce((s, r) => s + r.llmCalls, 0)}  ·  cost $${cost.toFixed(4)}\n` +
      `on-target citations ${rows.filter((r) => r.citedExpected).length}/${rows.length}  ·  ` +
      `failures ${rows.filter((r) => r.failed).length}  ·  ` +
      `forbidden tool calls ${rows.reduce((s, r) => s + r.forbiddenCalled.length, 0)}\n\n`,
  );
  for (const r of rows) {
    process.stdout.write(`${r.id}\n  tools: ${r.toolCalls.join(', ') || '-'}\n`);
    process.stdout.write(`  grades: ${r.grades.join(', ') || '-'}\n`);
    process.stdout.write(`  models: ${r.llmByRole.join(', ') || '-'}\n`);
    process.stdout.write(`  citations: ${r.citations.join(' | ') || '-'}\n`);
  }
}

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    await closeDb().catch(() => undefined);
    process.exitCode = 1;
  });
