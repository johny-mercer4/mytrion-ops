import { MODEL_PRICING } from '../../config/constants.js';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface TokenUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface CostBreakdown extends TokenUsage {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/** Strip a model's date/version suffix: gpt-4o-2024-08-06 -> gpt-4o. */
function baseModel(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function computeCost(usage: TokenUsage): CostBreakdown {
  const pricing = MODEL_PRICING[usage.model] ?? MODEL_PRICING[baseModel(usage.model)];
  const input = pricing?.input ?? 0;
  const output = pricing?.output ?? 0;
  const inputCost = (usage.promptTokens / 1_000_000) * input;
  const outputCost = (usage.completionTokens / 1_000_000) * output;
  return {
    ...usage,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

// Process-local rollup. Not durable across restarts — swap for a DB-backed rollup
// when per-tenant billing matters. Good enough for in-flight visibility + logs.
const tenantTotals = new Map<string, number>();

export const costTracker = {
  record(ctx: TenantContext, usage: TokenUsage): CostBreakdown {
    const cost = computeCost(usage);
    const prev = tenantTotals.get(ctx.tenantId) ?? 0;
    tenantTotals.set(ctx.tenantId, prev + cost.totalCost);
    logger.debug(
      {
        tenantId: ctx.tenantId,
        requestId: ctx.requestId,
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalCost: cost.totalCost,
      },
      'llm cost',
    );
    return cost;
  },

  tenantTotal(tenantId: string): number {
    return tenantTotals.get(tenantId) ?? 0;
  },

  reset(): void {
    tenantTotals.clear();
  },
};
