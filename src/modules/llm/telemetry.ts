import { createHash } from 'node:crypto';
import { logger } from '../../lib/logger.js';
import { llmCallRepo } from '../../repos/llmCallRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { computeCost } from './costTracker.js';
import type { ModelRole, ResolvedModel } from './modelRouter.js';

export function privacyHash(value: string): string {
  return createHash('sha256').update(value.trim().replace(/\s+/g, ' ').toLowerCase()).digest('hex');
}

export interface LlmTelemetryInput {
  ctx: TenantContext;
  conversationId?: string;
  agentRunId?: string;
  role: ModelRole | string;
  resolved: ResolvedModel;
  status: 'ok' | 'error';
  latencyMs: number;
  /** Time to first token, when the call streamed. */
  ttftMs?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  retryCount?: number;
  fallbackFrom?: string;
  requestHash?: string;
}

/** Telemetry is best-effort and must never fail a user turn. Raw prompts are never persisted. */
export async function recordLlmTelemetry(input: LlmTelemetryInput): Promise<void> {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const cost = computeCost({
    model: input.resolved.model,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    cachedPromptTokens: input.cachedInputTokens ?? 0,
  });
  try {
    await llmCallRepo.record(input.ctx, {
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
      role: input.role,
      provider: input.resolved.provider,
      model: input.resolved.model,
      status: input.status,
      latencyMs: input.latencyMs,
      ...(input.ttftMs !== undefined ? { ttftMs: input.ttftMs } : {}),
      inputTokens,
      cachedInputTokens: input.cachedInputTokens ?? 0,
      outputTokens,
      reasoningTokens: input.reasoningTokens ?? 0,
      estimatedCost: cost.totalCost.toFixed(6),
      retryCount: input.retryCount ?? 0,
      ...(input.fallbackFrom ? { fallbackFrom: input.fallbackFrom } : {}),
      ...(input.requestHash ? { requestHash: input.requestHash } : {}),
    });
  } catch (err) {
    logger.warn({ err }, 'llm_calls telemetry write failed');
  }
}
