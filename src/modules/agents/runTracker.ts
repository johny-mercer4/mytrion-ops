/**
 * LangChain callback handler that observes one agent run: token usage (for cost + budget) and
 * which specialists the orchestrator delegated to (agentPath). Usage is accumulated across the
 * whole run and costed against the primary model id — per-child token split is approximated
 * (children usually share the default child model); exact per-agent tool attribution lives in
 * tool_calls.acting_agent.
 */
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import { computeCost } from '../llm/costTracker.js';
import { recordLlmTelemetry } from '../llm/telemetry.js';
import type { Provider } from '../llm/openaiClient.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { BudgetMeter } from './budget.js';
import type { TurnTraceEmitter } from './turnInspection.js';

interface Serialized {
  id?: string[];
  name?: string;
}

export class RunTracker extends BaseCallbackHandler {
  override name = 'octane-run-tracker';
  promptTokens = 0;
  completionTokens = 0;
  /** Prompt tokens served from provider KV / prompt cache (when reported). */
  cachedPromptTokens = 0;
  readonly agentPath: string[] = [];
  private readonly llmStarts = new Map<string, { at: number; model: string }>();
  private measuredCost = 0;

  constructor(
    private readonly modelId: string,
    private readonly budget?: BudgetMeter,
    private readonly telemetry?: {
      ctx: TenantContext;
      agentRunId: string;
      conversationId: string;
      role: string;
      inspect?: TurnTraceEmitter;
    },
  ) {
    super();
  }

  override async handleLLMStart(
    _llm: Serialized,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const invocation = extraParams?.['invocation_params'];
    const invocationModel = invocation && typeof invocation === 'object'
      ? (invocation as Record<string, unknown>)['model'] ?? (invocation as Record<string, unknown>)['model_name']
      : undefined;
    const metaModel = metadata?.['ls_model_name'];
    const model = typeof invocationModel === 'string'
      ? invocationModel
      : typeof metaModel === 'string'
        ? metaModel
        : this.modelId;
    this.llmStarts.set(runId, { at: Date.now(), model });
    this.telemetry?.inspect?.({
      stage: 'model',
      status: 'running',
      label: `Calling ${model}`,
      model,
      modelRole: this.telemetry.role,
      provider: model.includes('/') ? 'groq' : model.startsWith('glm-') ? 'glm' : 'openai',
    });
  }

  /** Fraction of prompt tokens that were cache hits (0–1), or null when unknown. */
  cacheHitRate(): number | null {
    if (this.promptTokens <= 0 || this.cachedPromptTokens <= 0) {
      return this.promptTokens > 0 && this.cachedPromptTokens === 0 ? 0 : null;
    }
    return Math.min(1, this.cachedPromptTokens / this.promptTokens);
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    let prompt = 0;
    let completion = 0;
    let cached = 0;
    const usage = output.llmOutput?.['tokenUsage'] as
      | {
          promptTokens?: number;
          completionTokens?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
          promptTokensDetails?: { cachedTokens?: number };
          input_token_details?: { cache_read?: number };
        }
      | undefined;
    if (usage && (usage.promptTokens || usage.completionTokens || usage.prompt_tokens)) {
      prompt = usage.promptTokens ?? usage.prompt_tokens ?? 0;
      completion = usage.completionTokens ?? usage.completion_tokens ?? 0;
      cached =
        usage.promptTokensDetails?.cachedTokens ??
        usage.input_token_details?.cache_read ??
        0;
    } else {
      // Streaming path: usage arrives on the message's usage_metadata instead of llmOutput.
      for (const generations of output.generations) {
        for (const gen of generations) {
          const meta = (
            gen as {
              message?: {
                usage_metadata?: {
                  input_tokens?: number;
                  output_tokens?: number;
                  input_token_details?: { cache_read?: number };
                };
              };
            }
          ).message?.usage_metadata;
          if (meta) {
            prompt += meta.input_tokens ?? 0;
            completion += meta.output_tokens ?? 0;
            cached += meta.input_token_details?.cache_read ?? 0;
          }
        }
      }
    }
    const started = this.llmStarts.get(runId);
    const model = started?.model ?? this.modelId;
    const provider: Provider = model.includes('/') ? 'groq' : model.startsWith('glm-') ? 'glm' : 'openai';
    this.telemetry?.inspect?.({
      stage: 'model',
      status: 'complete',
      label: `${model} responded`,
      model,
      modelRole: this.telemetry.role,
      provider,
      durationMs: started ? Date.now() - started.at : 0,
      details: {
        inputTokens: prompt,
        outputTokens: completion,
        cachedInputTokens: cached,
      },
    });
    if (prompt === 0 && completion === 0) {
      this.llmStarts.delete(runId);
      return;
    }
    this.promptTokens += prompt;
    this.completionTokens += completion;
    this.cachedPromptTokens += cached;
    if (this.budget) {
      const cost = computeCost({ model, promptTokens: prompt, completionTokens: completion });
      this.budget.charge(cost.totalCost);
      this.measuredCost += cost.totalCost;
    }
    if (this.telemetry) {
      await recordLlmTelemetry({
        ctx: this.telemetry.ctx,
        conversationId: this.telemetry.conversationId,
        agentRunId: this.telemetry.agentRunId,
        role: this.telemetry.role,
        resolved: { provider, model },
        status: 'ok',
        latencyMs: started ? Date.now() - started.at : 0,
        inputTokens: prompt,
        cachedInputTokens: cached,
        outputTokens: completion,
      });
    }
    this.llmStarts.delete(runId);
  }

  override async handleToolStart(
    tool: Serialized,
    input: string,
    _runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    const toolName = runName ?? tool.name ?? tool.id?.at(-1);
    if (toolName !== 'task') return;
    try {
      const parsed = JSON.parse(input) as { subagent_type?: string };
      if (parsed.subagent_type) {
        this.agentPath.push(parsed.subagent_type);
        // Ping-pong detection (Agentic Evaluation Metrics standard)
        // If the orchestrator has delegated more than 3 times in a single turn, it's thrashing.
        if (this.agentPath.length >= 4) {
          throw new Error(`Ping-pong deadlock detected: [${this.agentPath.join(' -> ')}]. The orchestrator must route correctly without endless bouncing.`);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Ping-pong')) throw err;
      // input not JSON — ignore; agentPath is best-effort observability.
    }
  }

  totalCost(): number {
    if (this.measuredCost > 0) return this.measuredCost;
    return computeCost({
      model: this.modelId,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
    }).totalCost;
  }
}
