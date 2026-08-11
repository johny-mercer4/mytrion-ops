/**
 * LLM completion plumbing for the chat loop: per-turn model resolution for both non-streaming and
 * streaming turns. Kept separate from chatService so that file stays under the size cap.
 *
 * This carried a cross-provider Groq→OpenAI fallback until 2026-08-12, including the subtle rule
 * that a mid-stream failure may only be retried while nothing has reached the wire (re-running after
 * tokens are visible duplicates output). With Groq removed, every branch of it was unreachable —
 * `turn.provider` is always `'openai'`, so the guard clause fired first every time. If a second
 * provider is ever added, that rule is the part worth restoring; see git history for the shape.
 */
import type OpenAI from 'openai';
import { env } from '../../config/env.js';
import { completionParams } from '../llm/modelParams.js';
import { getClient, type Provider } from '../llm/openaiClient.js';
import { resolveModel } from '../llm/modelRouter.js';
import type { SSEStream } from './streaming.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type Usage = OpenAI.Completions.CompletionUsage;

/**
 * The provider+model for a turn. `fellBack` is retained and always false: it is written into the
 * turn's audit detail, and dropping the field would silently change the shape of historical audit
 * rows rather than just removing a code path.
 */
export interface TurnModel {
  provider: Provider;
  model: string;
  fellBack: boolean;
}

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
}

/** Resolve the worker model for a turn (an override selects a different OpenAI model). */
export function newTurnModel(modelOverride?: string): TurnModel {
  const resolved = resolveModel('worker', { model: modelOverride });
  return { provider: resolved.provider, model: resolved.model, fellBack: false };
}

/** Base params for the turn's current model: output cap + model-aware sampling params. */
function turnParams(turn: TurnModel, messages: ChatMessage[], tools: ChatTool[]) {
  return {
    model: turn.model,
    messages,
    ...completionParams(turn.model, env.LLM_MAX_OUTPUT_TOKENS),
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
  };
}

/** Non-streaming completion for the turn's model. */
export function createCompletion(
  turn: TurnModel,
  messages: ChatMessage[],
  tools: ChatTool[],
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return getClient(turn.provider).chat.completions.create(turnParams(turn, messages, tools));
}

/** Open a streaming completion for the turn's model. */
function openStream(
  turn: TurnModel,
  messages: ChatMessage[],
  tools: ChatTool[],
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    ...turnParams(turn, messages, tools),
    stream: true,
    stream_options: { include_usage: true },
  };
  return getClient(turn.provider).chat.completions.create(params);
}

/** Stream a turn. Errors surface to the caller — there is no second provider to retry on. */
export async function streamTurn(
  turn: TurnModel,
  messages: ChatMessage[],
  tools: ChatTool[],
  sse: SSEStream,
): Promise<StreamResult> {
  return consumeStream(await openStream(turn, messages, tools), sse);
}

async function consumeStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  sse: SSEStream,
): Promise<StreamResult> {
  let content = '';
  let usage: Usage | null = null;
  const acc = new Map<number, { id: string; name: string; args: string }>();

  for await (const chunk of stream) {
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      sse.send('token', { text: delta.content });
    }
    for (const tcd of delta.tool_calls ?? []) {
      const cur = acc.get(tcd.index) ?? { id: '', name: '', args: '' };
      if (tcd.id) cur.id = tcd.id;
      if (tcd.function?.name) cur.name += tcd.function.name;
      if (tcd.function?.arguments) cur.args += tcd.function.arguments;
      acc.set(tcd.index, cur);
    }
  }

  const toolCalls: ToolCall[] = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ id: v.id, type: 'function', function: { name: v.name, arguments: v.args } }));
  return { content, toolCalls, usage };
}
