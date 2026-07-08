/**
 * LLM completion plumbing for the chat loop: per-turn provider/model resolution (Groq worker when
 * enabled, OpenAI otherwise) with a one-shot Groq→OpenAI fallback, for both non-streaming and
 * streaming turns. Kept separate from chatService so that file stays under the size cap.
 */
import type OpenAI from 'openai';
import { env } from '../../config/env.js';
import { errorMessage } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { completionParams } from '../llm/modelParams.js';
import { getClient, models, type Provider } from '../llm/openaiClient.js';
import { resolveModel } from '../llm/modelRouter.js';
import type { SSEStream } from './streaming.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type Usage = OpenAI.Completions.CompletionUsage;

/** The provider+model for a turn, plus whether we fell back to OpenAI mid-turn. */
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

/** Resolve the worker model for a turn (Groq when enabled; OpenAI otherwise / on override). */
export function newTurnModel(modelOverride?: string): TurnModel {
  const resolved = resolveModel('worker', { model: modelOverride });
  return { provider: resolved.provider, model: resolved.model, fellBack: false };
}

/** Mutate the turn to fall back to OpenAI (used after a Groq failure). */
function fallBackToOpenAI(turn: TurnModel, err: unknown): void {
  logger.warn(
    { err: errorMessage(err), model: turn.model },
    'completion failed on groq; falling back to OpenAI for the rest of the turn',
  );
  turn.provider = 'openai';
  turn.model = models.default;
  turn.fellBack = true;
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

/** Non-streaming completion with one-shot fallback to OpenAI on a Groq error. */
export async function createCompletion(
  turn: TurnModel,
  messages: ChatMessage[],
  tools: ChatTool[],
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  try {
    return await getClient(turn.provider).chat.completions.create(turnParams(turn, messages, tools));
  } catch (err) {
    if (turn.provider === 'openai') throw err;
    fallBackToOpenAI(turn, err);
    return getClient('openai').chat.completions.create(turnParams(turn, messages, tools));
  }
}

/** Open a streaming completion for the turn's current provider. No fallback here — see streamTurn. */
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

/** Tracks whether any token has reached the client, so a mid-stream fallback can't duplicate output. */
interface StreamProgress {
  emitted: boolean;
}

/**
 * Stream a turn with Groq→OpenAI fallback that covers BOTH a failed stream open and a failure
 * mid-iteration. We only fall back while nothing has been streamed yet — once tokens are on the
 * wire, re-running on OpenAI would duplicate visible output, so we surface the error instead.
 */
export async function streamTurn(
  turn: TurnModel,
  messages: ChatMessage[],
  tools: ChatTool[],
  sse: SSEStream,
): Promise<StreamResult> {
  const progress: StreamProgress = { emitted: false };
  try {
    return await consumeStream(await openStream(turn, messages, tools), sse, progress);
  } catch (err) {
    if (turn.provider === 'openai' || progress.emitted) throw err;
    fallBackToOpenAI(turn, err);
    return consumeStream(await openStream(turn, messages, tools), sse, progress);
  }
}

async function consumeStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  sse: SSEStream,
  progress: StreamProgress,
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
      progress.emitted = true;
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
