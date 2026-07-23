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
import type { BudgetMeter } from './budget.js';

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

  constructor(
    private readonly modelId: string,
    private readonly budget?: BudgetMeter,
  ) {
    super();
  }

  /** Fraction of prompt tokens that were cache hits (0–1), or null when unknown. */
  cacheHitRate(): number | null {
    if (this.promptTokens <= 0 || this.cachedPromptTokens <= 0) {
      return this.promptTokens > 0 && this.cachedPromptTokens === 0 ? 0 : null;
    }
    return Math.min(1, this.cachedPromptTokens / this.promptTokens);
  }

  override async handleLLMEnd(output: LLMResult): Promise<void> {
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
    if (prompt === 0 && completion === 0) return;
    this.promptTokens += prompt;
    this.completionTokens += completion;
    this.cachedPromptTokens += cached;
    if (this.budget) {
      const cost = computeCost({ model: this.modelId, promptTokens: prompt, completionTokens: completion });
      this.budget.charge(cost.totalCost);
    }
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
    return computeCost({
      model: this.modelId,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
    }).totalCost;
  }
}
