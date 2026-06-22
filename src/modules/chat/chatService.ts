import type OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DEFAULT_RETRIEVAL_K, MAX_TOOL_ITERATIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError, errorMessage, NotFoundError, RBACError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { conversationRepo } from '../../repos/conversationRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { retrieve } from '../knowledge/retriever.js';
import { costTracker } from '../llm/costTracker.js';
import { getClient, models, type Provider } from '../llm/openaiClient.js';
import { resolveModel } from '../llm/modelRouter.js';
import { buildSystemPrompt, knowledgeGroundingNote } from '../llm/promptBuilder.js';
import { toolRegistry } from '../tools/index.js';
import { messageStore } from './messageStore.js';
import type { SSEStream } from './streaming.js';
import { dispatchTool } from './toolDispatcher.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type AssistantMessage = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
type Usage = OpenAI.Completions.CompletionUsage;

export interface ChatToolCallSummary {
  name: string;
  status: 'ok' | 'error' | 'denied';
}

export interface ChatTurnResult {
  conversationId: string;
  message: string;
  toolCalls: ChatToolCallSummary[];
  usage: { promptTokens: number; completionTokens: number; totalCost: number };
  iterations: number;
  /** Number of RBAC-scoped pgvector passages injected as grounding for this turn. */
  ragPassages: number;
}

export interface ChatTurnOptions {
  model?: string;
  /** Display name of the end-user (e.g. from a Zoho widget) — added to the system prompt. */
  userName?: string;
}

// OpenAI function names must match ^[a-zA-Z0-9_-]+$, but our tool ids use dots
// (e.g. 'zoho_people.search_employees'). Map '.' <-> '__' across the boundary.
const toOpenAiToolName = (name: string): string => name.replace(/\./g, '__');
const fromOpenAiToolName = (name: string): string => name.replace(/__/g, '.');

function buildTools(ctx: TenantContext): ChatTool[] {
  return toolRegistry.listForContext(ctx).map((tool) => ({
    type: 'function',
    function: {
      name: toOpenAiToolName(tool.name),
      description: tool.description,
      // zod -> JSON Schema; inline refs so OpenAI gets a self-contained schema.
      parameters: zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' }) as Record<
        string,
        unknown
      >,
    },
  }));
}

async function ensureConversation(ctx: TenantContext, conversationId?: string): Promise<string> {
  if (conversationId) {
    const conv = await conversationRepo.findOwned(ctx, conversationId);
    if (!conv) throw new NotFoundError('Conversation not found');
    return conv.id;
  }
  const created = await conversationRepo.create(ctx, {});
  return created.id;
}

/**
 * Always-on RAG: embed the user's message and pull RBAC-scoped passages from pgvector.
 * Isolation (tenant + audience + department_access) is enforced in knowledgeRepo, so the
 * grounding a caller sees is already limited to what their departments/keys allow.
 * Retrieval failures degrade gracefully (chat continues without grounded context).
 */
async function retrieveGrounding(
  ctx: TenantContext,
  query: string,
): Promise<{ content: string; count: number } | null> {
  if (!env.FF_RAG_ENABLED) return null;
  try {
    const passages = await retrieve(ctx, query, DEFAULT_RETRIEVAL_K);
    if (passages.length === 0) return null;
    const body = passages
      .map((p, i) => `[#${i + 1} · doc ${p.docId} · score ${p.score.toFixed(3)}]\n${p.content}`)
      .join('\n\n');
    return { content: `${knowledgeGroundingNote()}\n\n${body}`, count: passages.length };
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'RAG grounding retrieval failed; continuing without it');
    return null;
  }
}

/** Build the LLM message list for a turn: system prompt, RAG grounding, then history. */
async function buildTurnMessages(
  ctx: TenantContext,
  conversationId: string,
  userMessage: string,
  userName?: string,
): Promise<{ messages: ChatMessage[]; ragPassages: number }> {
  const history = await messageStore.loadHistory(ctx, conversationId);
  const messages: ChatMessage[] = [{ role: 'system', content: buildSystemPrompt(ctx) }];
  if (userName) {
    messages.push({
      role: 'system',
      content: `You are assisting "${userName}". Address them naturally when appropriate.`,
    });
  }
  const grounding = await retrieveGrounding(ctx, userMessage);
  if (grounding) messages.push({ role: 'system', content: grounding.content });
  messages.push(...history);
  return { messages, ragPassages: grounding?.count ?? 0 };
}

/**
 * Some Groq-hosted models (gpt-oss/Llama) wrap tool-call JSON in XML-ish tags, a python tag,
 * or markdown fences. Strip those before parsing so we don't spuriously fail valid calls.
 */
function sanitizeToolArgs(raw: string): string {
  let s = raw.trim();
  s = s.replace(/<\|python_tag\|>/g, '').trim();
  const fn = /<function[^>]*>([\s\S]*?)<\/function>/i.exec(s);
  if (fn?.[1]) s = fn[1].trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence?.[1]) s = fence[1].trim();
  return s;
}

/** Execute a single tool call. Never throws — failures become a tool message the model can read. */
async function runToolCall(
  ctx: TenantContext,
  conversationId: string,
  toolCall: ToolCall,
): Promise<{ content: string; status: ChatToolCallSummary['status']; toolName: string }> {
  const toolName = fromOpenAiToolName(toolCall.function.name);
  let args: unknown = {};
  try {
    args = toolCall.function.arguments ? JSON.parse(sanitizeToolArgs(toolCall.function.arguments)) : {};
  } catch {
    return {
      toolName,
      status: 'error',
      content: JSON.stringify({ error: 'Tool arguments were not valid JSON' }),
    };
  }
  try {
    const result = await dispatchTool(toolName, args, ctx, { conversationId });
    return { toolName, status: 'ok', content: JSON.stringify(result ?? null) };
  } catch (err) {
    const status = err instanceof RBACError ? 'denied' : 'error';
    return { toolName, status, content: JSON.stringify({ error: errorMessage(err) }) };
  }
}

function recordUsage(
  ctx: TenantContext,
  model: string,
  usage: Usage | null | undefined,
  acc: { promptTokens: number; completionTokens: number; totalCost: number },
): void {
  if (!usage) return;
  acc.promptTokens += usage.prompt_tokens;
  acc.completionTokens += usage.completion_tokens;
  acc.totalCost += costTracker.record(ctx, {
    model,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
  }).totalCost;
}

function pushAssistant(messages: ChatMessage[], content: string, toolCalls: ToolCall[]): void {
  const assistant: AssistantMessage = { role: 'assistant', content: content.length > 0 ? content : null };
  if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
  messages.push(assistant);
}

async function persistAssistant(
  ctx: TenantContext,
  conversationId: string,
  content: string,
  toolCalls: ToolCall[],
  model: string,
  usage: Usage | null | undefined,
): Promise<void> {
  const input: Parameters<typeof messageStore.appendAssistant>[2] = { content, model };
  if (toolCalls.length > 0) input.toolCalls = toolCalls;
  if (usage) {
    input.promptTokens = usage.prompt_tokens;
    input.completionTokens = usage.completion_tokens;
  }
  await messageStore.appendAssistant(ctx, conversationId, input);
}

/**
 * Non-streaming chat turn. Persists the user message, runs the LLM + tool loop
 * (bounded by MAX_TOOL_ITERATIONS), persists every step, and returns the final answer.
 */
export async function runChatTurn(
  conversationId: string | undefined,
  userMessage: string,
  ctx: TenantContext,
  opts: ChatTurnOptions = {},
): Promise<ChatTurnResult> {
  const convId = await ensureConversation(ctx, conversationId);
  await messageStore.appendUser(ctx, convId, userMessage);

  const { messages, ragPassages } = await buildTurnMessages(ctx, convId, userMessage, opts.userName);
  const tools = buildTools(ctx);
  const turn = newTurnModel(opts);

  const usageAcc = { promptTokens: 0, completionTokens: 0, totalCost: 0 };
  const toolSummaries: ChatToolCallSummary[] = [];
  let finalContent = '';
  let iterations = 0;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
    iterations = i + 1;
    const completion = await createCompletion(turn, messages, tools);
    recordUsage(ctx, turn.model, completion.usage, usageAcc);

    const message = completion.choices[0]?.message;
    if (!message) throw new AppError('LLM returned no choices', { statusCode: 502 });
    const content = message.content ?? '';
    const toolCalls = message.tool_calls ?? [];

    await persistAssistant(ctx, convId, content, toolCalls, turn.model, completion.usage);
    pushAssistant(messages, content, toolCalls);

    if (toolCalls.length === 0) {
      finalContent = content;
      break;
    }

    for (const toolCall of toolCalls) {
      const { content: toolContent, status, toolName } = await runToolCall(ctx, convId, toolCall);
      toolSummaries.push({ name: toolName, status });
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolContent });
      await messageStore.appendToolResult(ctx, convId, {
        toolCallId: toolCall.id,
        name: toolName,
        content: toolContent,
      });
    }

    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalContent = content || 'I was unable to complete this within the tool-call limit.';
    }
  }

  await conversationRepo.touch(ctx, convId);
  await auditFromContext(ctx, {
    action: 'chat.turn',
    status: 'ok',
    resourceType: 'conversation',
    resourceId: convId,
    detail: { iterations, toolCalls: toolSummaries.length, ragPassages, provider: turn.provider, fellBack: turn.fellBack, ...usageAcc },
  });

  return {
    conversationId: convId,
    message: finalContent,
    toolCalls: toolSummaries,
    usage: usageAcc,
    iterations,
    ragPassages,
  };
}

/** The provider+model for a turn, plus whether we fell back to OpenAI mid-turn. */
interface TurnModel {
  provider: Provider;
  model: string;
  fellBack: boolean;
}

/** Resolve the worker model for a turn (Groq when enabled; OpenAI otherwise / on override). */
function newTurnModel(opts: ChatTurnOptions): TurnModel {
  const resolved = resolveModel('worker', { model: opts.model });
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

/** Non-streaming completion with one-shot fallback to OpenAI on a Groq error. */
async function createCompletion(
  turn: TurnModel,
  messages: ChatMessage[],
  tools: ChatTool[],
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const params = {
    model: turn.model,
    messages,
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
  };
  try {
    return await getClient(turn.provider).chat.completions.create(params);
  } catch (err) {
    if (turn.provider === 'openai') throw err;
    fallBackToOpenAI(turn, err);
    return getClient('openai').chat.completions.create({ ...params, model: turn.model });
  }
}

/** Streaming completion with one-shot fallback to OpenAI if opening the stream fails. */
async function openCompletionStream(
  turn: TurnModel,
  messages: ChatMessage[],
  tools: ChatTool[],
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: turn.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
  };
  try {
    return await getClient(turn.provider).chat.completions.create(params);
  } catch (err) {
    if (turn.provider === 'openai') throw err;
    fallBackToOpenAI(turn, err);
    return getClient('openai').chat.completions.create({ ...params, model: turn.model });
  }
}

async function consumeStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  sse: SSEStream,
): Promise<{ content: string; toolCalls: ToolCall[]; usage: Usage | null }> {
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

/**
 * Streaming chat turn over SSE. Emits: start, status (dynamic stage labels), context,
 * token (per content delta), tool_call, tool_result, and a final done event.
 */
export async function streamChatTurn(
  conversationId: string | undefined,
  userMessage: string,
  ctx: TenantContext,
  sse: SSEStream,
  opts: ChatTurnOptions = {},
): Promise<ChatTurnResult> {
  const convId = await ensureConversation(ctx, conversationId);
  sse.send('start', { conversationId: convId });
  await messageStore.appendUser(ctx, convId, userMessage);

  // Dynamic status: searching the knowledge base (real stage, no extra LLM).
  if (env.FF_RAG_ENABLED) {
    sse.send('status', { state: 'retrieving', label: 'Searching the knowledge base…' });
  }
  const { messages, ragPassages } = await buildTurnMessages(ctx, convId, userMessage, opts.userName);
  sse.send('context', { passages: ragPassages });
  const tools = buildTools(ctx);
  const turn = newTurnModel(opts);

  const usageAcc = { promptTokens: 0, completionTokens: 0, totalCost: 0 };
  const toolSummaries: ChatToolCallSummary[] = [];
  let finalContent = '';
  let iterations = 0;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
    iterations = i + 1;
    // Dynamic status: first pass mentions grounded sources; later passes are post-tool reasoning.
    const thinkingLabel =
      i === 0
        ? ragPassages > 0
          ? `Reviewing ${ragPassages} source${ragPassages === 1 ? '' : 's'}…`
          : 'Thinking…'
        : 'Thinking it through…';
    sse.send('status', { state: 'thinking', label: thinkingLabel });
    const stream = await openCompletionStream(turn, messages, tools);
    const { content, toolCalls, usage } = await consumeStream(stream, sse);
    recordUsage(ctx, turn.model, usage, usageAcc);

    await persistAssistant(ctx, convId, content, toolCalls, turn.model, usage);
    pushAssistant(messages, content, toolCalls);

    if (toolCalls.length === 0) {
      finalContent = content;
      break;
    }

    for (const toolCall of toolCalls) {
      const callName = fromOpenAiToolName(toolCall.function.name);
      sse.send('tool_call', { name: callName });
      sse.send('status', { state: 'tool', label: `Using ${callName}…` });
      const { content: toolContent, status, toolName } = await runToolCall(ctx, convId, toolCall);
      toolSummaries.push({ name: toolName, status });
      sse.send('tool_result', { name: toolName, status });
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolContent });
      await messageStore.appendToolResult(ctx, convId, {
        toolCallId: toolCall.id,
        name: toolName,
        content: toolContent,
      });
    }

    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalContent = content || 'I was unable to complete this within the tool-call limit.';
    }
  }

  await conversationRepo.touch(ctx, convId);
  await auditFromContext(ctx, {
    action: 'chat.turn',
    status: 'ok',
    resourceType: 'conversation',
    resourceId: convId,
    detail: { iterations, toolCalls: toolSummaries.length, streamed: true, ragPassages, provider: turn.provider, fellBack: turn.fellBack, ...usageAcc },
  });

  const result: ChatTurnResult = {
    conversationId: convId,
    message: finalContent,
    toolCalls: toolSummaries,
    usage: usageAcc,
    iterations,
    ragPassages,
  };
  sse.send('done', result);
  return result;
}
