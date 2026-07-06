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
export function baseModel(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

// Unknown model ids are charged at conservative gpt-4o rates rather than $0 — fail-safe
// direction: the AGENT_MAX_COST_USD guard trips early instead of never. Warn once per id.
const FALLBACK_PRICING_MODEL = 'gpt-4o';
const warnedUnknownModels = new Set<string>();

export function computeCost(usage: TokenUsage): CostBreakdown {
  let pricing = MODEL_PRICING[usage.model] ?? MODEL_PRICING[baseModel(usage.model)];
  if (!pricing) {
    if (!warnedUnknownModels.has(usage.model)) {
      warnedUnknownModels.add(usage.model);
      logger.warn(
        { model: usage.model, fallback: FALLBACK_PRICING_MODEL },
        'no pricing for model; charging conservative fallback rates so budget guards still trip',
      );
    }
    pricing = MODEL_PRICING[FALLBACK_PRICING_MODEL];
  }
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
