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

/** One scored question. A case is a first turn plus zero or more follow-ups in the same conversation. */
interface BenchTurn {
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

interface BenchCase extends BenchTurn {
  id: string;
  /**
   * Turns 2..n, replayed against the SAME conversationId. These are the only cases that can show
   * whether the turn-context contract earns its keep: every single-turn case scores identically with
   * FF_RAG_V2_CONTEXT on or off, because there is no prior turn to carry. Each follow-up is written
   * so it is UNANSWERABLE on its own — its subject is a bare pronoun — so a correct answer is
   * evidence that context survived the turn boundary, not that the retriever got lucky.
   */
  followUps?: readonly BenchTurn[];
}

/**
 * Tools a documented how-to must never call. The `crm.*` entries were added 2026-08-12 after the
 * skill library shipped: `sales-client-book` sent a how-to question to `crm.pick_my_client` instead
 * of `knowledge_search`, and the bench reported "forbidden tool calls 0" while scoring it 0/2,
 * because the list only covered CRM/warehouse tools. A forbid list that misses the tool actually
 * being misused is worse than none — it reads as a clean bill of health.
 *
 * Names are as the model sees them: LangChain binds dotted registry names with '.' mapped to '__'.
 */
const NO_LIVE_DATA = [
  'zoho_crm.query',
  'zoho_crm.search',
  'warehouse.my_gallons',
  'crm.pick_my_client',
  'crm__pick_my_client',
  'crm.list_my_clients',
  'crm__list_my_clients',
  'crm.carrier_balance',
  'crm__carrier_balance',
  'crm.list_cards',
  'crm__list_cards',
  'crm.transactions',
  'crm__transactions',
  'crm.carrier_overview',
  'crm__carrier_overview',
  'crm.payment_info',
  'crm__payment_info',
];

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
  // --- skill-benefit: facts carried ONLY by the authored skills, not by the RAG corpus ---
  //
  // The rest of this bench is documentation lookup, which the corpus answers with or without skills
  // — so it measures the skill library's COST (+41% wall) and never its benefit. These five ask for
  // facts that exist in `src/modules/agents/skills/**` and nowhere a retrieval can reach, each
  // anchored on a distinctive token so the assertion is not prose-matching:
  //   26/25   the cycle rule            (sales-cycle)
  //   Monday  ISO week start            (sales-cycle / sales-progress)
  //   Closed Lost  Ops vacation denial  (sales-retention-invoices)
  //   500     crm.transactions page cap (sales-client-book)
  // Run with FF_AGENT_SKILLS=0 vs 1 to measure what the library actually buys.
  {
    id: 'skill-cycle-dates',
    question:
      'What rule defines the start and end of the current sales cycle at Octane? Give me the day-of-month boundaries.',
    expectDocs: [],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['26', '25'],
  },
  {
    id: 'skill-week-start',
    question: "When I ask for my swipes 'this week', which day of the week does that period start on?",
    expectDocs: [],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['Monday'],
  },
  {
    id: 'skill-vacation-denial',
    question:
      'A retention case of mine was marked Vacation and Ops denied it. What happens to my Zoho deal as a result?',
    expectDocs: [],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['Closed Lost'],
  },
  {
    id: 'skill-transactions-cap',
    question:
      "If I pull a busy client's transactions over six months, am I seeing every row? Is there a limit I should know about?",
    expectDocs: [],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['500'],
  },
  {
    /**
     * CONTROL, not a skill probe — and it is here precisely because it is NOT discriminating.
     *
     * The anchor `2 business day` is documented in the retention corpus, so it scored 3/3 with
     * FF_AGENT_SKILLS=0 as well. That makes it worthless for measuring the skill library and
     * valuable for the opposite purpose: it proves the skills did not BREAK ordinary corpus recall.
     * A skill-benefit suite where every case improves is a suite that cannot detect a regression.
     */
    id: 'control-sla-corpus-recall',
    question:
      'The 2 business day action deadline on my retention case came and went and nothing happened at all. Is the automation broken?',
    expectDocs: [],
    forbidTools: NO_LIVE_DATA,
    expectPhrases: ['2 business day'],
  },
  // --- multi-turn: the only cases where the turn-context contract can show a benefit ---
  // Each follow-up's subject is a pronoun with no antecedent in its own text, so answering it at all
  // requires the prior turn. Scored on the follow-up's OWN expected documents.
  {
    id: 'mt-fraud-then-override',
    question: "A client's card is on fraud hold — what are my options in Sales Mytrion?",
    expectDocs: ['Fraud Hold', 'Override'],
    forbidTools: NO_LIVE_DATA,
    followUps: [
      {
        // "that one" = the override option from turn 1. Alone this retrieves nothing useful.
        question: 'How long does that one last?',
        expectDocs: ['Override'],
        forbidTools: NO_LIVE_DATA,
      },
    ],
  },
  {
    id: 'mt-openpool-then-cap',
    question: 'How do I claim a case from the Open Pool?',
    expectDocs: ['Retention'],
    forbidTools: NO_LIVE_DATA,
    followUps: [
      {
        // "them" = Open Pool claims. Requires carrying the subject across the boundary.
        question: 'How many of them can I do in one day?',
        expectDocs: ['Retention'],
        forbidTools: NO_LIVE_DATA,
        expectPhrases: ['2'],
      },
    ],
  },
  {
    id: 'mt-balance-then-cards',
    question: "How do I check a client's balance?",
    expectDocs: ['Balance Check'],
    forbidTools: NO_LIVE_DATA,
    followUps: [
      {
        // Splitting the old compound `balance-and-cards` case across two turns. Turn 2 names no
        // subject at all, so the retriever must inherit "a client" from turn 1.
        question: 'And how do I see their card list?',
        expectDocs: ['Card Status'],
        forbidTools: NO_LIVE_DATA,
      },
    ],
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

async function ask(
  turn: BenchTurn,
  conversationId?: string,
): Promise<{ res: AgentResponse; wallMs: number }> {
  const startedAt = Date.now();
  const response = await fetch(`${API}/v1/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.API_KEY },
    body: JSON.stringify({
      message: turn.question,
      agent: 'sales',
      zoho_user_id: '42',
      user_name: 'Bench Admin',
      profile: 'Administrator',
      // Omitted on turn 1 so each case starts a fresh conversation; supplied on follow-ups, which is
      // what makes them multi-TURN rather than three unrelated questions.
      ...(conversationId ? { conversationId } : {}),
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
    // Telemetry is keyed by conversation, so a follow-up would re-count its predecessor's rag/llm
    // rows. Attribute each row to the first turn that sees it.
    const seen = new Set<string>();
    let conversationId = '';

    const turns: BenchTurn[] = [bench, ...(bench.followUps ?? [])];
    for (const [index, turn] of turns.entries()) {
      const { res, wallMs } = await ask(turn, conversationId || undefined);
      conversationId = res.conversationId ?? conversationId;
      const all = conversationId ? await telemetryFor(conversationId) : { rag: [], llm: [] };
      const rag = all.rag.filter((r) => !seen.has(r.id));
      const llm = all.llm.filter((c) => !seen.has(c.id));
      for (const r of [...rag, ...llm]) seen.add(r.id);

      const toolCalls = (res.toolCalls ?? []).map((t) => t.name);
      const citations = (res.citations ?? []).map((c) => c.title ?? c.id);

      rows.push({
        id: index === 0 ? bench.id : `${bench.id}#${index + 1}`,
        wallMs,
        failed: Boolean(res.error),
        expected: turn.expectDocs.length,
        matched: turn.expectDocs.filter((want) => citations.some((t) => t.includes(want))).length,
        phrasesExpected: turn.expectPhrases?.length ?? 0,
        phrasesMatched:
          turn.expectPhrases?.filter((want) => loosely(res.message ?? '').includes(loosely(want))).length ?? 0,
        citations: [...new Set(citations)],
        toolCalls,
        forbiddenCalled: toolCalls.filter((name) => turn.forbidTools.includes(name)),
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
  }

  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }

  const pad = (s: string, n: number): string => s.padEnd(n);
  process.stdout.write(
    `\n${pad('case', 28)}${pad('wall', 9)}${pad('llm', 6)}${pad('llmMs', 8)}${pad('rag', 5)}${pad('ragMs', 8)}${pad('hops', 6)}${pad('tools', 7)}${pad('docs', 8)}${pad('answer', 8)}bad\n`,
  );
  process.stdout.write(`${'-'.repeat(96)}\n`);
  for (const r of rows) {
    process.stdout.write(
      pad(r.id, 28) +
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
    // Distinct row ids, not CASES — follow-up turns are scored as their own rows (`id#2`).
    for (const id of [...new Set(rows.map((r) => r.id))]) {
      const mine = rows.filter((r) => r.id === id);
      const cov = mine.map((r) => `${r.matched}/${r.expected}`);
      const stable = new Set(cov).size === 1;
      const meanMs = Math.round(mine.reduce((s2, r) => s2 + r.wallMs, 0) / (mine.length || 1));
      process.stdout.write(
        `  ${id.padEnd(28)} ${cov.join(' ')}  ${stable ? 'stable' : 'UNSTABLE'}  mean ${meanMs}ms\n`,
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
