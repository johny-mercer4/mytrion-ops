/**
 * Model-aware LLM parameter shaping — the one place that knows gpt-5-class / o-series
 * ("reasoning tier") models reject a non-default `temperature` and take
 * `max_completion_tokens` instead of `max_tokens`. Both pipelines build their params here:
 * the chat loop via completionParams (raw OpenAI SDK, also valid for Groq's
 * OpenAI-compatible API) and the agent stack via chatOpenAIFields (LangChain ChatOpenAI).
 */
import { baseModel } from './costTracker.js';

/** gpt-5* / o1-o9* models: fixed sampling params, output capped via max_completion_tokens. */
export function isReasoningTier(model: string): boolean {
  return /^(gpt-5|o\d)/.test(baseModel(model));
}

export type CompletionParams =
  | { max_completion_tokens: number }
  | { max_tokens: number; temperature: number };

/** Spreadable params for raw `chat.completions.create` calls. */
export function completionParams(model: string, maxTokens: number): CompletionParams {
  return isReasoningTier(model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens, temperature: 0 };
}

export type ChatOpenAIFields =
  | { maxCompletionTokens: number }
  | { maxTokens: number; temperature: number };

/** Spreadable constructor fields for LangChain ChatOpenAI (agent path). */
export function chatOpenAIFields(model: string, maxTokens: number): ChatOpenAIFields {
  return isReasoningTier(model)
    ? { maxCompletionTokens: maxTokens }
    : { maxTokens, temperature: 0 };
}
