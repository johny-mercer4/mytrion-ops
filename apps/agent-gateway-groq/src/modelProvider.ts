import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { getOpenAIClient } from './openaiClient.js';
import { modelToolDefinitions, type ToolManifest } from './toolRuntime.js';
import { incrementCounter } from './metrics.js';

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ModelMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string };

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}

export interface ModelCompletion {
  text: string;
  toolCalls: ModelToolCall[];
  usage: ModelUsage;
  provider: 'openai';
  model: string;
}

/** Convert the gateway's small common message format to Responses API input items. */
export function toOpenAIInput(
  messages: readonly ModelMessage[],
): OpenAI.Responses.ResponseInput {
  const input: OpenAI.Responses.ResponseInput = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content,
      });
      continue;
    }
    if (message.role === 'assistant') {
      if (message.content) input.push({ role: 'assistant', content: message.content });
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      continue;
    }
    input.push({ role: message.role, content: message.content });
  }
  return input;
}

function toOpenAITools(manifests: readonly ToolManifest[]): OpenAI.Responses.FunctionTool[] {
  return modelToolDefinitions(manifests).map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    // Existing manifests are runtime-validated by toolDispatcher; some schemas do not meet
    // OpenAI strict-mode's additionalProperties/required constraints.
    strict: false,
  }));
}

function emptyUsage(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
}

async function completeWithOpenAI(
  messages: readonly ModelMessage[],
  manifests: readonly ToolManifest[],
  safetyIdentifier: string,
  requiredTool: string | undefined,
): Promise<ModelCompletion> {
  const tools = toOpenAITools(manifests);
  const response = await getOpenAIClient().responses.create({
    model: config.openaiModel,
    input: toOpenAIInput(messages),
    ...(tools.length
      ? {
          tools,
          tool_choice: requiredTool
            ? { type: 'function' as const, name: requiredTool }
            : ('auto' as const),
          parallel_tool_calls: false,
        }
      : {}),
    reasoning: { effort: config.openaiReasoningEffort },
    max_output_tokens: config.openaiMaxOutputTokens,
    safety_identifier: safetyIdentifier,
    store: false,
  });
  const toolCalls = response.output
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      id: item.call_id,
      name: item.name,
      arguments: item.arguments,
    }));
  return {
    text: response.output_text,
    toolCalls,
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: response.usage.input_tokens_details.cached_tokens,
          cacheWriteInputTokens: response.usage.input_tokens_details.cache_write_tokens,
        }
      : emptyUsage(),
    provider: 'openai',
    model: response.model,
  };
}

export function safetyIdentifierForChat(chatId: number): string {
  return createHash('sha256').update(`telegram-chat:${chatId}`).digest('hex');
}

export async function completeModel(
  messages: readonly ModelMessage[],
  manifests: readonly ToolManifest[],
  safetyIdentifier: string,
  requiredTool?: string,
): Promise<ModelCompletion> {
  if (requiredTool && !manifests.some((manifest) => manifest.name === requiredTool)) {
    throw new Error(`Required tool "${requiredTool}" is not available for this turn`);
  }
  try {
    return await completeWithOpenAI(messages, manifests, safetyIdentifier, requiredTool);
  } catch (error) {
    const status =
      error instanceof OpenAI.APIError
        ? error.status
        : typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : undefined;
    incrementCounter(status === 429 ? 'openai_429_total' : 'openai_error_total');
    throw error;
  }
}
