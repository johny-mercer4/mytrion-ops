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
