/**
 * Per-run budget guards for agent runs: tool-call count, dollar cost, and wall-clock time.
 * A runaway orchestrator/child loop trips BudgetExceededError; the run aborts with a partial
 * answer and an `agent.budget_exceeded` audit entry (caller's responsibility).
 */
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

export class BudgetExceededError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 429, code: 'AGENT_BUDGET_EXCEEDED' });
  }
}

export interface RunBudget {
  maxToolCalls: number;
  maxCostUsd: number;
  maxWallMs: number;
}

export function defaultRunBudget(): RunBudget {
  return {
    maxToolCalls: env.AGENT_MAX_TOOL_CALLS,
    maxCostUsd: env.AGENT_MAX_COST_USD,
    maxWallMs: env.AGENT_MAX_WALL_MS,
  };
}

export class BudgetMeter {
  private toolCalls = 0;
  private costUsd = 0;
  private readonly startedAt: number;

  constructor(
    private readonly budget: RunBudget = defaultRunBudget(),
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = this.now();
  }

  /** Record one tool call, then re-check limits (throws BudgetExceededError on breach). */
  countToolCall(): void {
    this.toolCalls += 1;
    this.assertOk();
  }

  /** Record LLM spend in USD (computed by the caller from token usage × pricing). */
  charge(costUsd: number): void {
    if (Number.isFinite(costUsd) && costUsd > 0) this.costUsd += costUsd;
    this.assertOk();
  }

  /** Throw when any limit is breached. Cheap — safe to call between loop iterations. */
  assertOk(): void {
    if (this.toolCalls > this.budget.maxToolCalls) {
      throw new BudgetExceededError(
        `agent run exceeded ${this.budget.maxToolCalls} tool calls`,
      );
    }
    if (this.costUsd > this.budget.maxCostUsd) {
      throw new BudgetExceededError(
        `agent run exceeded $${this.budget.maxCostUsd.toFixed(2)} LLM budget`,
      );
    }
    if (this.now() - this.startedAt > this.budget.maxWallMs) {
      throw new BudgetExceededError(
        `agent run exceeded ${this.budget.maxWallMs}ms wall-clock budget`,
      );
    }
  }

  snapshot(): { toolCalls: number; costUsd: number; elapsedMs: number } {
    return {
      toolCalls: this.toolCalls,
      costUsd: this.costUsd,
      elapsedMs: this.now() - this.startedAt,
    };
  }
}
