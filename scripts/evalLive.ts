/**
 * Behavioral eval harness: golden tasks through the REAL agent runtime (real OpenAI + the
 * CONFIGURED dev DB) with deterministic checks first and an LLM judge (OpenAI reasoning tier)
 * for grounding/refusal quality. Referenced by tests/unit/agent-golden.test.ts as the
 * behavioral counterpart of the static policy suite; the CI-safe machinery subset lives in
 * tests/unit/agent-scripted-turn.test.ts.
 *
 *   pnpm eval:live                       # full suite
 *   pnpm eval:live --category routing    # one category
 *   pnpm eval:live --id greeting-1       # one task
 *   pnpm eval:live --max-cost 1.0        # tighten the suite spend cap (USD)
 *   EVAL_AGENT_SOTA=1 pnpm eval:live --category sota
 *     # enables checkpoints + blackboard + plan/hard DAG + skill cache + CRAG
 *   pnpm eval:live --baseline eval-reports/baseline-sota-phase2.json
 *     # fail on category/KPI regression vs committed floors
 *
 * Requires MYTRION_OPS_DATABASE_URL + OPENAI_API_KEY. Do NOT point at production: the run
 * ingests the fixture corpus AND writes conversations/messages/agent_runs rows. Non-localhost
 * DB hosts are refused unless EVAL_I_KNOW_THIS_IS_NOT_PROD=1.
 */
import 'dotenv/config';
import './lib/evalSotaBootstrap.js';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import PQueue from 'p-queue';
import { databaseUrl, env } from '../src/config/env.js';
import { closeDb } from '../src/db/client.js';
import { logger } from '../src/lib/logger.js';
import { agentRegistry } from '../src/modules/agents/agentRegistry.js';
import { runAgentTurn, type AgentTurnResult } from '../src/modules/agents/orchestratorService.js';
import { systemContext } from '../src/modules/auth/authService.js';
import { ingestDocument } from '../src/modules/knowledge/ingestService.js';
import { models } from '../src/modules/llm/openaiClient.js';
import { judgedChecksFor, judgeTask } from './lib/behaviorJudge.js';
import {
  checkDeterministic,
  compareToBaseline,
  renderSummary,
  suiteKpis,
  summarize,
  toolSelectionScores,
  type EvalBaseline,
  type TaskReport,
} from './lib/behaviorReport.js';
import { loadBehaviorTasks, taskContext, type BehaviorTask } from './lib/behaviorTasks.js';

const TASK_TIMEOUT_MS = 180_000;
const CONCURRENCY = 3;

interface CorpusDoc {
  key: string;
  department: string | null;
  title: string;
  content: string;
}

function cliOption(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function assertSafeTarget(): void {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  if (!databaseUrl) throw new Error('MYTRION_OPS_DATABASE_URL is required');
  const host = new URL(databaseUrl).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local && process.env['EVAL_I_KNOW_THIS_IS_NOT_PROD'] !== '1') {
    throw new Error(
      `refusing to run against non-local DB host '${host}' — this run writes conversations/` +
        'agent_runs and ingests fixture docs. Set EVAL_I_KNOW_THIS_IS_NOT_PROD=1 for a dev/scratch DB.',
    );
  }
}

async function ingestCorpus(): Promise<Map<string, CorpusDoc>> {
  const corpus = JSON.parse(
    readFileSync(new URL('../tests/fixtures/retrieval-corpus.json', import.meta.url), 'utf-8'),
  ) as { docs: CorpusDoc[] };
  const ingestCtx = systemContext('eval-ingest');
  const byKey = new Map<string, CorpusDoc>();
  for (const doc of corpus.docs) {
    byKey.set(doc.key, doc);
    await ingestDocument(ingestCtx, {
      title: doc.title,
      content: doc.content,
      ...(doc.department ? { department: doc.department } : {}),
    });
  }
  return byKey;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

async function runTask(
  task: BehaviorTask,
  corpus: Map<string, CorpusDoc>,
): Promise<{ report: TaskReport; costUsd: number }> {
  const ctx = taskContext(task);
  const allowedAgents = agentRegistry.listForContext(ctx).map((m) => m.key);

  let result: AgentTurnResult | undefined;
  let costUsd = 0;
  let durationMs = 0;
  let conversationId: string | undefined;
  for (const turn of task.turns) {
    const turnStart = Date.now();
    result = await withTimeout(
      runAgentTurn(turn, ctx, {
        ...(task.agent ? { agent: task.agent } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(task.caller.userName ? { userName: task.caller.userName } : {}),
      }),
      TASK_TIMEOUT_MS,
      task.id,
    );
    durationMs += Date.now() - turnStart;
    conversationId = result.conversationId;
    costUsd += result.usage.totalCost;
  }
  if (!result) throw new Error(`task ${task.id} has no turns`);

  const deterministic = checkDeterministic(task, result, allowedAgents);
  const expectedTools = [
    ...(task.expect.mustCallTool ?? []),
    ...(task.expect.expectedToolCalls?.map((t) => t.name) ?? []),
  ];
  const actualTools = result.toolCalls.map((t) => t.name);
  const toolF1 =
    expectedTools.length > 0 ? toolSelectionScores(expectedTools, actualTools).f1 : undefined;
  const report: TaskReport = {
    id: task.id,
    category: task.category,
    verdict: deterministic.pass ? 'pass' : 'fail',
    failures: [...deterministic.failures],
    agentPath: result.agentPath,
    pingPongCount: result.agentPath.length > 1 ? result.agentPath.length - 1 : 0,
    durationMs,
    toolCalls: actualTools,
    costUsd,
    ...(toolF1 !== undefined ? { toolF1 } : {}),
    cacheHitRate: result.usage.cacheHitRate ?? null,
  };

  // The judge only runs when the mechanical half passed — a wrong route/tool already fails.
  if (deterministic.pass) {
    const refs = (task.expect.referenceDocs ?? [])
      .map((key) => corpus.get(key))
      .filter((d): d is CorpusDoc => Boolean(d))
      .map((d) => ({ key: d.key, title: d.title, content: d.content }));
    for (const check of judgedChecksFor(task)) {
      const { outcome, costUsd: judgeCost } = await judgeTask(task, result, check, refs);
      costUsd += judgeCost;
      (report.judge ??= []).push(outcome);
      if (outcome.verdict === 'fail') {
        report.verdict = 'fail';
        report.failures.push(`judge(${check}): ${outcome.reasoning}`);
      }
    }
  }
  report.costUsd = costUsd;
  return { report, costUsd };
}

async function main(): Promise<void> {
  assertSafeTarget();

  const maxCost = Number(cliOption('max-cost') ?? env.EVAL_MAX_COST_USD);
  const categoryFilter = cliOption('category');
  const idFilter = cliOption('id');

  // Match the prod agent posture; keep side-effectful subsystems out of the run —
  // unless EVAL_AGENT_SOTA=1 (checkpoints + blackboard + plan/hard DAG + skills + CRAG).
  const sotaProfile = process.env['EVAL_AGENT_SOTA'] === '1' || process.env['EVAL_AGENT_SOTA'] === 'true';
  const baselinePath = cliOption('baseline');
  const saved = {
    composio: env.FF_COMPOSIO_ENABLED,
    memory: env.FF_AGENT_MEMORY,
    checkpoints: env.FF_AGENT_CHECKPOINTS,
    agenticRag: env.FF_AGENTIC_RAG,
    blackboard: env.FF_AGENT_BLACKBOARD,
    skillCache: env.FF_AGENT_SKILL_CACHE,
    planDag: env.FF_AGENT_PLAN_DAG,
    hardDag: env.FF_AGENT_HARD_DAG,
    cragWeb: env.FF_CRAG_WEB_FALLBACK,
  };
  env.FF_COMPOSIO_ENABLED = false;
  env.FF_AGENTIC_RAG = false;
  if (sotaProfile) {
    env.FF_AGENT_MEMORY = true;
    env.FF_AGENT_CHECKPOINTS = true;
    env.FF_AGENT_BLACKBOARD = true;
    env.FF_AGENT_SKILL_CACHE = true;
    env.FF_AGENT_PLAN_DAG = true;
    env.FF_AGENT_HARD_DAG = true;
    env.FF_AGENTIC_RAG = true;
    env.FF_CRAG_WEB_FALLBACK = true;
    logger.info('EVAL_AGENT_SOTA=1 — enabling checkpoints/memory/blackboard/plan/hard-DAG/skills/CRAG');
  } else {
    env.FF_AGENT_MEMORY = false;
    env.FF_AGENT_CHECKPOINTS = false;
    env.FF_AGENT_BLACKBOARD = false;
    env.FF_AGENT_SKILL_CACHE = false;
    env.FF_AGENT_PLAN_DAG = false;
    env.FF_AGENT_HARD_DAG = false;
  }

  try {
    logger.info('ingesting fixture corpus (checksum-idempotent)…');
    const corpus = await ingestCorpus();

    let tasks = loadBehaviorTasks();
    if (!sotaProfile) tasks = tasks.filter((t) => t.category !== 'sota');
    if (categoryFilter) tasks = tasks.filter((t) => t.category === categoryFilter);
    if (idFilter) tasks = tasks.filter((t) => t.id === idFilter);
    if (tasks.length === 0) throw new Error('no tasks match the given filters');

    const reports: TaskReport[] = [];
    let spentUsd = 0;
    let capTripped = false;
    const queue = new PQueue({ concurrency: CONCURRENCY });

    for (const task of tasks) {
      void queue.add(async () => {
        if (task.requires.includes('servercrm') && !env.SERVER_CRM_URL) {
          reports.push({
            id: task.id, category: task.category, verdict: 'skip',
            failures: [], agentPath: [], pingPongCount: 0, durationMs: 0, toolCalls: [], costUsd: 0,
            note: 'SERVER_CRM_URL not configured',
          });
          return;
        }
        if (capTripped) {
          reports.push({
            id: task.id, category: task.category, verdict: 'skip',
            failures: [], agentPath: [], pingPongCount: 0, durationMs: 0, toolCalls: [], costUsd: 0,
            note: `suite cost cap ($${maxCost}) reached`,
          });
          return;
        }
        try {
          const { report, costUsd } = await runTask(task, corpus);
          spentUsd += costUsd;
          if (spentUsd > maxCost) capTripped = true;
          reports.push(report);
          logger.info(
            { id: task.id, verdict: report.verdict, pingPongCount: report.pingPongCount, durationMs: report.durationMs, agentPath: report.agentPath, costUsd: costUsd.toFixed(4) },
            'task done',
          );
        } catch (err) {
          reports.push({
            id: task.id, category: task.category, verdict: 'error',
            failures: [err instanceof Error ? err.message : String(err)],
            agentPath: [], pingPongCount: 0, durationMs: 0, toolCalls: [], costUsd: 0,
          });
          logger.warn({ id: task.id, err }, 'task errored');
        }
      });
    }
    await queue.onIdle();

    const summary = summarize(reports);
    const kpis = suiteKpis(reports);
    const failures = reports.filter((r) => r.verdict === 'fail' || r.verdict === 'error');

    console.log(`\n${renderSummary(summary)}\n`);
    console.log(
      `KPIs: avgPingPong=${kpis.avgPingPong.toFixed(2)} p50Ms=${kpis.p50DurationMs} p95Ms=${kpis.p95DurationMs}` +
        ` toolF1=${kpis.avgToolF1 === null ? 'n/a' : kpis.avgToolF1.toFixed(2)}` +
        ` kvHit=${kpis.avgCacheHitRate === null ? 'n/a' : kpis.avgCacheHitRate.toFixed(2)}`,
    );
    if (kpis.softBreaches.length > 0) {
      console.log(`KPI soft thresholds: ${kpis.softBreaches.join('; ')}`);
    }
    for (const f of failures) {
      console.log(`FAIL ${f.id} [${f.category}] — ${f.failures.join(' | ')}`);
    }
    console.log(
      `\ntotal spend: $${spentUsd.toFixed(3)} (cap $${maxCost})${capTripped ? ' — CAP TRIPPED' : ''}`,
    );

    let gitSha = 'unknown';
    try {
      gitSha = execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      /* not a git checkout */
    }
    mkdirSync(new URL('../eval-reports/', import.meta.url), { recursive: true });
    const reportPath = new URL(
      `../eval-reports/behavior-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      import.meta.url,
    );
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          gitSha,
          models: {
            orchestrator: env.ORCHESTRATOR_MODEL || models.default,
            child: env.AGENT_CHILD_MODEL || models.default,
            judge: models.reasoning,
          },
          spentUsd,
          capTripped,
          summary,
          kpis,
          tasks: reports,
        },
        null,
        2,
      ),
    );
    logger.info({ report: reportPath.pathname }, 'JSON report written');

    let baselineRegressed = false;
    if (baselinePath) {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as EvalBaseline;
      const regressions = compareToBaseline(summary, kpis, baseline);
      if (regressions.length > 0) {
        baselineRegressed = true;
        console.log(`\nBASELINE REGRESSION vs ${baselinePath}:`);
        for (const r of regressions) console.log(`  - ${r}`);
      } else {
        console.log(`\nBaseline OK vs ${baselinePath}`);
      }
    }

    const breached = Object.values(summary).some((s) => s.breached);
    if (breached || capTripped || baselineRegressed) process.exitCode = 1;
  } finally {
    env.FF_COMPOSIO_ENABLED = saved.composio;
    env.FF_AGENT_MEMORY = saved.memory;
    env.FF_AGENT_CHECKPOINTS = saved.checkpoints;
    env.FF_AGENTIC_RAG = saved.agenticRag;
    env.FF_AGENT_BLACKBOARD = saved.blackboard;
    env.FF_AGENT_SKILL_CACHE = saved.skillCache;
    env.FF_AGENT_PLAN_DAG = saved.planDag;
    env.FF_AGENT_HARD_DAG = saved.hardDag;
    env.FF_CRAG_WEB_FALLBACK = saved.cragWeb;
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'behavioral eval failed');
    await closeDb();
    process.exit(1);
  });
