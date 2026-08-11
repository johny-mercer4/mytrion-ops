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
 *   pnpm tsx scripts/benchSalesChat.ts [--json] [--runs N] [--reset-memory]
 *
 * Use `--runs 3 --reset-memory` before making a decision on a flag.
 *
 * `--runs 3` because a single run cannot separate a real change from model variance. `--reset-memory`
 * because distilled agent memory is recalled INTO every knowledge_search result and every bench turn
 * writes more of it, so the corpus grows under you between configs — see `reportMemoryState`.
 *
 * The header note used to say expected-doc coverage is simply not stable run-to-run (8/10 then 9/10,
 * `balance-and-cards` flipping 1/2 ↔ 2/2). From a CLEAN memory state that is no longer what happens:
 * across seven 3-run configs on 2026-08-11 every case was stable except where a real regression was
 * being measured, and the one dirty-state run reproduced exactly the old symptom. Treat instability
 * as a signal to check the memory row count first, not as inherent noise to shrug at.
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
import { and, count, eq } from 'drizzle-orm';
import { agentMemories } from '../src/db/schema/agent_memories.js';
import { agentSkills } from '../src/db/schema/agent_skills.js';

interface BenchCase {
  id: string;
  question: string;
  /**
   * Title substrings the answer should cite. Multi-entry cases are deliberately AMBIGUOUS — they
   * span two documents, which is the only shape where passage ordering matters. The four
   * single-document cases are clean vector hits, so measuring a reranker against those alone would
   * be rigged in its favour: there is nothing to reorder.
   */
  expectDocs: string[];
  /** Tools that must NOT be called: a documented how-to needs no live data. */
  forbidTools: string[];
  /**
   * Substrings the ANSWER must contain. Used only by the computational cases, where citing the right
   * document is not the question — getting the arithmetic right is. Every expectation here is
   * derivable from the retention document alone; questions whose answer the document does not fully
   * determine (worst-case totals chained across three agents, for instance) were discarded rather
   * than scored on a guess.
   */
  expectPhrases?: string[];
}

const NO_LIVE_DATA = ['zoho_crm.query', 'zoho_crm.search', 'warehouse.my_gallons'];

const CASES: readonly BenchCase[] = [
  // --- single-document: clean vector hits, the latency/regression baseline ---
  {
    id: 'card-activation',
    question: 'How do I activate a card in Sales Mytrion?',
    expectDocs: ['Card Activation'],
    forbidTools: NO_LIVE_DATA,
  },
  {
    id: 'retention-generation',
    question: 'How are Retention cases generated in Sales Mytrion?',
    expectDocs: ['Retention'],
    forbidTools: NO_LIVE_DATA,
  },
  {
    id: 'open-pool-claim',
    question: 'How do I claim a case from the Open Pool?',
    expectDocs: ['Retention'],
    forbidTools: NO_LIVE_DATA,
  },
  {
    id: 'limit-max',
    question: 'What is the maximum limit change per run in Automations?',
    expectDocs: ['Limits'],
    forbidTools: NO_LIVE_DATA,
  },
  // --- ambiguous: two documents each, where passage ordering can actually change the answer ---
  {
    // Fraud Hold / Release (C-10) requests a release; Override the Card (C-16) grants a ~30 minute
    // window WITHOUT lifting the hold. Semantically adjacent and easy to conflate — a complete
    // answer needs both.
    id: 'fraud-options',
    question: "A client's card is on fraud hold — what are my options in Sales Mytrion?",
    expectDocs: ['Fraud Hold', 'Override'],
    forbidTools: NO_LIVE_DATA,
  },
  {
    // Balance Check (C-8/Q-8) and Card Status Report (C-30) are two separate automations.
    id: 'balance-and-cards',
    question: "How do I check a client's balance and see their card list?",
    expectDocs: ['Balance Check', 'Card Status'],
    forbidTools: NO_LIVE_DATA,
  },
  {
    // Money codes appear in Data Center (viewing issued codes) AND as automation C-17 (drawing one).
    id: 'money-codes-view-and-draw',
    question: 'Where do I see issued money codes, and how do I draw a new one?',
    expectDocs: ['Money Code', 'Data Center'],
    forbidTools: NO_LIVE_DATA,
  },
  // --- computational: arithmetic and chaining over the retention timers ---
  {
    // 1-business-day SLA per attempt; five failed attempts may go to Open Pool. 5 - 3 = 2.
    id: 'calc-out-of-reach-attempts',
    question:
      "An Out of Reach retention case already has 3 failed contact attempts. How many more attempts before it can be sent to Open Pool, and what is the SLA per attempt?",
    expectDocs: ['Retention'],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['2', '1 business day'],
  },
  {
    // Available 3 business days; unclaimed -> Retention for a 10-business-day wait.
    id: 'calc-pool-then-retention',
    question:
      'If an Open Pool item goes unclaimed, how many business days is it available, and how long does it then wait in Retention?',
    expectDocs: ['Retention'],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['3 business day', '10 business day'],
  },
  {
    // Maximum 2 approved claims per agent per UTC day.
    id: 'calc-claim-cap',
    question:
      'I have already claimed 2 cases from the Open Pool today. Can I claim another one right now?',
    expectDocs: ['Retention'],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['2'],
  },
  {
    // 14-calendar-day countdown, then a 2-business-day follow-up.
    id: 'calc-vacation-sequence',
    question:
      'A retention case was marked Vacation. What is the countdown before follow-up, and how long is the follow-up window?',
    expectDocs: ['Retention'],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['14', '2 business day'],
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

/**
 * Normalise for phrase matching. The retention document writes "1-business-day SLA" and
 * "10-business-day wait", and the model reproduces that hyphenation faithfully — so a space-separated
 * assertion scored a correct answer as a miss. Three "failures" this session turned out to be the
 * measurement rather than the system; this one is the same class.
 */
const loosely = (text: string): string => text.toLowerCase().replace(/[-\u2011\u2013\u2014]/g, ' ').replace(/\s+/g, ' ');

const API = process.env['BENCH_API'] ?? 'http://localhost:3011';
const AS_JSON = process.argv.includes('--json');
const RESET_MEMORY = process.argv.includes('--reset-memory');
const RUNS = (() => {
  const at = process.argv.indexOf('--runs');
  const n = at >= 0 ? Number(process.argv[at + 1]) : 1;
  return Number.isInteger(n) && n > 0 ? n : 1;
})();

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
  expected: number;
  matched: number;
  phrasesExpected: number;
  phrasesMatched: number;
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

/**
 * Distilled agent memory is recalled INTO every `knowledge_search` result (scopedRag calls
 * `recallMemories`), and every bench turn writes more of it. So the corpus the agent answers from
 * grows monotonically across runs, and two "identical" configs measured an hour apart are not
 * actually identical.
 *
 * Measured 2026-08-11: the same config scored 38/42 with 567 accumulated memory rows and 39/42 from
 * a clean state, with `balance-and-cards` destabilising in the dirty run — which is the same size
 * and shape as the run-to-run drift this script was written to warn about.
 *
 * So: always report the starting state, and offer `--reset-memory` to control it. The truncate is
 * guarded to a local database because it is destructive and the app DB URL points at Render.
 */
async function reportMemoryState(): Promise<void> {
  // Guard BEFORE any query: `.env` points at Render by default, and a remote host would otherwise
  // be connected to (and hang on DNS/TCP) before the refusal is ever reached.
  if (RESET_MEMORY && !/@(localhost|127\.0\.0\.1|host\.docker\.internal)[:/]/.test(env.MYTRION_OPS_DATABASE_URL)) {
    process.stderr.write(
      '--reset-memory refused: MYTRION_OPS_DATABASE_URL is not a local database. ' +
        'Point it at the local bench DB before resetting.\n',
    );
    process.exit(1);
  }

  const [mem] = await db.select({ n: count() }).from(agentMemories);
  const [skills] = await db.select({ n: count() }).from(agentSkills);
  const dirty = (mem?.n ?? 0) + (skills?.n ?? 0);

  if (RESET_MEMORY) {
    await db.delete(agentMemories);
    await db.delete(agentSkills);
    process.stdout.write(`memory state: reset (cleared ${dirty} rows)\n\n`);
    return;
  }

  process.stdout.write(
    `memory state: ${mem?.n ?? 0} memories, ${skills?.n ?? 0} skills` +
      (dirty > 0 ? '  ← carried into every answer; use --reset-memory to compare configs cleanly' : '') +
      '\n\n',
  );
}

async function main(): Promise<void> {
  await reportMemoryState();
  const rows: Row[] = [];
  for (let run = 0; run < RUNS; run += 1)
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
      expected: bench.expectDocs.length,
      matched: bench.expectDocs.filter((want) => citations.some((t) => t.includes(want))).length,
      phrasesExpected: bench.expectPhrases?.length ?? 0,
      phrasesMatched:
        bench.expectPhrases?.filter((want) => loosely(res.message ?? '').includes(loosely(want))).length ?? 0,
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
    `\n${pad('case', 22)}${pad('wall', 9)}${pad('llm', 6)}${pad('llmMs', 8)}${pad('rag', 5)}${pad('ragMs', 8)}${pad('hops', 6)}${pad('tools', 7)}${pad('docs', 8)}${pad('answer', 8)}bad\n`,
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
        pad(r.failed ? 'FAILED' : `${r.matched}/${r.expected}`, 8) +
        pad(r.phrasesExpected > 0 ? `${r.phrasesMatched}/${r.phrasesExpected}` : '-', 8) +
        (r.forbiddenCalled.length > 0 ? r.forbiddenCalled.join(',') : '-') +
        '\n',
    );
  }
  const total = rows.reduce((s, r) => s + r.wallMs, 0);
  const cost = rows.reduce((s, r) => s + r.costUsd, 0);
  process.stdout.write(
    `\ntotal wall ${total}ms  ·  mean ${Math.round(total / rows.length)}ms  ·  ` +
      `llm calls ${rows.reduce((s, r) => s + r.llmCalls, 0)}  ·  cost $${cost.toFixed(4)}\n` +
      `expected-doc coverage ${rows.reduce((s2, r) => s2 + r.matched, 0)}/${rows.reduce((s2, r) => s2 + r.expected, 0)}  ·  ` +
      `answer facts ${rows.reduce((s2, r) => s2 + r.phrasesMatched, 0)}/${rows.reduce((s2, r) => s2 + r.phrasesExpected, 0)}  ·  ` +
      `failures ${rows.filter((r) => r.failed).length}  ·  ` +
      `forbidden tool calls ${rows.reduce((s, r) => s + r.forbiddenCalled.length, 0)}\n\n`,
  );
  if (RUNS > 1) {
    process.stdout.write(`per-case stability over ${RUNS} runs:\n`);
    for (const bench of CASES) {
      const mine = rows.filter((r) => r.id === bench.id);
      const cov = mine.map((r) => `${r.matched}/${r.expected}`);
      const stable = new Set(cov).size === 1;
      const meanMs = Math.round(mine.reduce((s2, r) => s2 + r.wallMs, 0) / (mine.length || 1));
      process.stdout.write(
        `  ${bench.id.padEnd(26)} ${cov.join(' ')}  ${stable ? 'stable' : 'UNSTABLE'}  mean ${meanMs}ms\n`,
      );
    }
    process.stdout.write('\n');
  }

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
