/**
 * Deterministic checks, aggregation, thresholds, and reporting for the behavioral eval.
 * Deterministic checks run FIRST and outrank the judge: routing / tool-name assertions are
 * mechanical comparisons against AgentTurnResult — no model opinion involved.
 */
import type { AgentTurnResult } from '../../src/modules/agents/orchestratorService.js';
import type { BehaviorTask, TaskCategory } from './behaviorTasks.js';
import type { JudgeOutcome } from './behaviorJudge.js';

/** Minimum pass rate per category (skips excluded). Breach ⇒ non-zero exit. */
export const CATEGORY_THRESHOLDS: Record<TaskCategory, number> = {
  rbac: 1.0,
  greeting: 1.0,
  routing: 0.9,
  grounding: 0.8,
  refusal: 0.75,
  delegation: 0.75,
  'tool-selection': 0.75,
  'web-navigation': 0.5,
  // SotA Phase 1 profile (EVAL_AGENT_SOTA=1): looser until baseline is recorded.
  sota: 0.5,
};

/** LangChain normalizes registry tool names ('crm.pick_my_client' → 'crm__pick_my_client'). */
function canonical(name: string): string {
  return name.replace(/__/g, '.');
}

function matchesSubset(actual: any, subset: any): boolean {
  if (subset === undefined || subset === null) return true;
  if (typeof actual !== 'object' || actual === null) return false;
  for (const [k, v] of Object.entries(subset)) {
    if (typeof v === 'object' && v !== null) {
      if (!matchesSubset(actual[k], v)) return false;
    } else {
      if (actual[k] !== v) return false;
    }
  }
  return true;
}

export interface DeterministicVerdict {
  pass: boolean;
  failures: string[];
}

export function checkDeterministic(
  task: BehaviorTask,
  result: AgentTurnResult,
  allowedAgents: string[],
): DeterministicVerdict {
  const failures: string[] = [];
  const e = task.expect;
  const calledTools = result.toolCalls.map((t) => canonical(t.name));

  // Global invariant: delegation can never reach an agent outside the caller's RBAC set.
  for (const hop of result.agentPath) {
    if (!allowedAgents.includes(hop)) {
      failures.push(`agentPath contains '${hop}' outside the caller's allowed agents`);
    }
  }

  if (e.routedAgent === 'none') {
    if (result.agentPath.length > 0) {
      failures.push(`expected no delegation, got agentPath [${result.agentPath.join(' → ')}]`);
    }
  } else if (e.routedAgent) {
    if (result.agentPath[0] !== e.routedAgent) {
      failures.push(
        `expected first hop '${e.routedAgent}', got [${result.agentPath.join(' → ') || 'none'}]`,
      );
    }
  }
  if (e.routedOneOf) {
    const first = result.agentPath[0];
    if (!first || !e.routedOneOf.includes(first as (typeof e.routedOneOf)[number])) {
      failures.push(
        `expected first hop in {${e.routedOneOf.join(', ')}}, got [${result.agentPath.join(' → ') || 'none'}]`,
      );
    }
  }
  for (const agent of e.mustRouteTo ?? []) {
    if (!result.agentPath.includes(agent)) failures.push(`expected agentPath to contain '${agent}'`);
  }
  for (const name of e.mustCallTool ?? []) {
    if (!calledTools.includes(canonical(name))) failures.push(`expected tool call '${name}'`);
  }
  for (const name of e.mustNotCallTool ?? []) {
    if (calledTools.includes(canonical(name))) failures.push(`forbidden tool call '${name}'`);
  }
  if (e.maxToolCalls !== undefined && result.toolCalls.length > e.maxToolCalls) {
    failures.push(
      `expected ≤${e.maxToolCalls} tool calls, got ${result.toolCalls.length} (${calledTools.join(', ')})`,
    );
  }
  if (e.expectedToolCalls) {
    for (const exp of e.expectedToolCalls) {
      const expName = canonical(exp.name);
      const match = result.toolCalls.find((t) => {
        if (canonical(t.name) !== expName) return false;
        if (!exp.argsSubset) return true;
        let actualArgs = typeof t.args === 'string' ? JSON.parse(t.args) : (t.args || {});
        if (typeof actualArgs.input === 'string') {
          try {
            actualArgs = JSON.parse(actualArgs.input);
          } catch {
            // keep as is
          }
        }
        console.log(`[DEBUG] tool ${t.name} actual args:`, actualArgs, `expected args:`, exp.argsSubset);
        return matchesSubset(actualArgs, exp.argsSubset);
      });
      if (!match) {
        failures.push(`expected tool call '${expName}' with args ${JSON.stringify(exp.argsSubset || {})} was not found`);
      }
    }
  }

  return { pass: failures.length === 0, failures };
}

/** Set-level tool selection scores (expected vs actual tool names). */
export function toolSelectionScores(
  expectedTools: string[],
  actualTools: string[],
): { precision: number; recall: number; f1: number } {
  const exp = new Set(expectedTools.map(canonical));
  const act = new Set(actualTools.map(canonical));
  if (exp.size === 0 && act.size === 0) return { precision: 1, recall: 1, f1: 1 };
  if (exp.size === 0) return { precision: 0, recall: 1, f1: 0 };
  if (act.size === 0) return { precision: 1, recall: 0, f1: 0 };
  let tp = 0;
  for (const t of act) if (exp.has(t)) tp += 1;
  const precision = tp / act.size;
  const recall = tp / exp.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export type TaskVerdict = 'pass' | 'fail' | 'skip' | 'error';

export interface TaskReport {
  id: string;
  category: TaskCategory;
  verdict: TaskVerdict;
  failures: string[];
  agentPath: string[];
  pingPongCount: number;
  durationMs: number;
  toolCalls: string[];
  costUsd: number;
  toolF1?: number;
  cacheHitRate?: number | null;
  judge?: JudgeOutcome[];
  /** Skip reason or runtime error message. */
  note?: string;
}

export interface CategorySummary {
  pass: number;
  fail: number;
  skip: number;
  passRate: number | null;
  threshold: number;
  breached: boolean;
}

export function summarize(reports: TaskReport[]): Record<string, CategorySummary> {
  const out: Record<string, CategorySummary> = {};
  for (const [category, threshold] of Object.entries(CATEGORY_THRESHOLDS)) {
    const rows = reports.filter((r) => r.category === category);
    if (rows.length === 0) continue;
    const pass = rows.filter((r) => r.verdict === 'pass').length;
    const skip = rows.filter((r) => r.verdict === 'skip').length;
    const fail = rows.length - pass - skip; // 'error' counts as fail
    const evaluated = pass + fail;
    const passRate = evaluated > 0 ? pass / evaluated : null;
    out[category] = {
      pass,
      fail,
      skip,
      passRate,
      threshold,
      breached: passRate !== null && passRate < threshold,
    };
  }
  return out;
}

export function renderSummary(summary: Record<string, CategorySummary>): string {
  const lines = ['category         pass  fail  skip  rate    threshold'];
  for (const [category, s] of Object.entries(summary)) {
    const rate = s.passRate === null ? '  n/a' : s.passRate.toFixed(2).padStart(5);
    const flag = s.breached ? '  ← BREACH' : '';
    lines.push(
      `${category.padEnd(16)} ${String(s.pass).padStart(4)} ${String(s.fail).padStart(5)} ${String(s.skip).padStart(5)}  ${rate}   ≥${s.threshold.toFixed(2)}${flag}`,
    );
  }
  return lines.join('\n');
}

/** Soft suite KPI ceilings — breach is advisory in logs unless --baseline is used. */
export const KPI_SOFT_THRESHOLDS = {
  avgPingPongMax: 3,
  p95DurationMsMax: 180_000,
  avgToolF1Min: 0.4,
} as const;

/** Suite-level KPIs (ping-pong, duration percentiles, tool F1, KV hit). */
export function suiteKpis(reports: TaskReport[]): {
  avgPingPong: number;
  p50DurationMs: number;
  p95DurationMs: number;
  avgToolF1: number | null;
  avgCacheHitRate: number | null;
  softBreaches: string[];
} {
  const evaluated = reports.filter((r) => r.verdict === 'pass' || r.verdict === 'fail');
  const durations = evaluated.map((r) => r.durationMs).sort((a, b) => a - b);
  const pct = (p: number) => {
    if (durations.length === 0) return 0;
    // Nearest-rank: index = ceil(p/100 * n) - 1
    const i = Math.min(durations.length - 1, Math.max(0, Math.ceil((p / 100) * durations.length) - 1));
    return durations[i] ?? 0;
  };
  const f1s = evaluated.map((r) => r.toolF1).filter((x): x is number => typeof x === 'number');
  const hits = evaluated
    .map((r) => r.cacheHitRate)
    .filter((x): x is number => typeof x === 'number');
  const avgPingPong =
    evaluated.length === 0
      ? 0
      : evaluated.reduce((s, r) => s + r.pingPongCount, 0) / evaluated.length;
  const p50DurationMs = pct(50);
  const p95DurationMs = pct(95);
  const avgToolF1 = f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null;
  const avgCacheHitRate = hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : null;
  const softBreaches: string[] = [];
  if (avgPingPong > KPI_SOFT_THRESHOLDS.avgPingPongMax) {
    softBreaches.push(
      `avgPingPong ${avgPingPong.toFixed(2)} > soft max ${KPI_SOFT_THRESHOLDS.avgPingPongMax}`,
    );
  }
  if (p95DurationMs > KPI_SOFT_THRESHOLDS.p95DurationMsMax) {
    softBreaches.push(
      `p95DurationMs ${p95DurationMs} > soft max ${KPI_SOFT_THRESHOLDS.p95DurationMsMax}`,
    );
  }
  if (avgToolF1 !== null && avgToolF1 < KPI_SOFT_THRESHOLDS.avgToolF1Min) {
    softBreaches.push(
      `avgToolF1 ${avgToolF1.toFixed(2)} < soft min ${KPI_SOFT_THRESHOLDS.avgToolF1Min}`,
    );
  }
  return {
    avgPingPong,
    p50DurationMs,
    p95DurationMs,
    avgToolF1,
    avgCacheHitRate,
    softBreaches,
  };
}

export interface EvalBaseline {
  summary?: Record<string, { passRate?: number | null }>;
  kpis?: {
    avgPingPong?: number;
    p95DurationMs?: number;
    avgToolF1?: number | null;
    avgCacheHitRate?: number | null;
  };
}

/** Compare a run against a committed baseline; returns human-readable regressions. */
export function compareToBaseline(
  summary: Record<string, CategorySummary>,
  kpis: ReturnType<typeof suiteKpis>,
  baseline: EvalBaseline,
  /** Absolute pass-rate drop allowed before counting as regression (default 5pp). */
  passRateSlack = 0.05,
): string[] {
  const regressions: string[] = [];
  for (const [category, base] of Object.entries(baseline.summary ?? {})) {
    if (base.passRate === null || base.passRate === undefined) continue;
    const cur = summary[category];
    if (!cur || cur.passRate === null) continue;
    if (cur.passRate + passRateSlack < base.passRate) {
      regressions.push(
        `${category} passRate ${cur.passRate.toFixed(2)} < baseline ${base.passRate.toFixed(2)} (−${passRateSlack} slack)`,
      );
    }
  }
  const bk = baseline.kpis ?? {};
  if (typeof bk.avgPingPong === 'number' && kpis.avgPingPong > bk.avgPingPong) {
    regressions.push(`avgPingPong ${kpis.avgPingPong.toFixed(2)} > baseline ${bk.avgPingPong}`);
  }
  if (typeof bk.p95DurationMs === 'number' && kpis.p95DurationMs > bk.p95DurationMs) {
    regressions.push(`p95DurationMs ${kpis.p95DurationMs} > baseline ${bk.p95DurationMs}`);
  }
  if (
    typeof bk.avgToolF1 === 'number' &&
    kpis.avgToolF1 !== null &&
    kpis.avgToolF1 + 0.05 < bk.avgToolF1
  ) {
    regressions.push(
      `avgToolF1 ${kpis.avgToolF1.toFixed(2)} < baseline ${bk.avgToolF1.toFixed(2)}`,
    );
  }
  return regressions;
}
