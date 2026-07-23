import type OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DEFAULT_RETRIEVAL_K, MAX_TOOL_ITERATIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError, errorMessage, RBACError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { Conversation, Message } from '../../db/schema/index.js';
import { conversationRepo, type CreateConversationInput } from '../../repos/conversationRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { retrieve } from '../knowledge/retriever.js';
import { costTracker } from '../llm/costTracker.js';
import { createCompletion, newTurnModel, streamTurn } from './completion.js';
import { buildSystemPrompt, knowledgeGroundingNote } from '../llm/promptBuilder.js';
import { wrapUntrusted } from '../security/untrusted.js';
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
  // --- Zoho widget session metadata, persisted on the conversation/messages ---
  zohoUserId?: string;
  profile?: string;
  role?: string;
  departmentScope?: string | string[];
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
      // MCP tools carry their own JSON Schema (rawParameters); native tools derive it from zod.
      parameters:
        tool.rawParameters ??
        (zodToJsonSchema(tool.inputSchema, { $refStrategy: 'none' }) as Record<string, unknown>),
    },
  }));
}

/** Conversation metadata seeded from the caller's Zoho identity (for the session row). */
function conversationMeta(ctx: TenantContext, opts: ChatTurnOptions): CreateConversationInput {
  const meta: CreateConversationInput = {};
  if (opts.zohoUserId) meta.zohoUserId = opts.zohoUserId;
  const userName = opts.userName ?? ctx.userName;
  if (userName) meta.userName = userName;
  if (opts.profile) meta.profile = opts.profile;
  if (opts.role) meta.role = opts.role;
  if (opts.departmentScope !== undefined) meta.departmentScope = opts.departmentScope;
  return meta;
}

/**
 * Resolve the conversation: use the provided id when it's the caller's own; otherwise (absent OR
 * unknown/foreign) create a fresh one seeded with the caller's metadata. The widget then keeps the
 * id returned in the `start` event. Returns the row so callers can auto-title on first turn.
 */
async function ensureConversation(
  ctx: TenantContext,
  conversationId: string | undefined,
  meta: CreateConversationInput,
): Promise<Conversation> {
  if (conversationId) {
    const conv = await conversationRepo.findOwned(ctx, conversationId);
    if (conv) return conv;
    logger.warn({ conversationId }, 'chat: unknown/foreign conversation id; creating a new one');
  }
  return conversationRepo.create(ctx, meta);
}

/** First user message → a short title (≤60 chars, trimmed on a word boundary). */
function deriveTitle(message: string): string {
  const clean = message.trim().replace(/\s+/g, ' ');
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

interface FinalizeInput {
  lastAssistant?: Message | undefined;
  ragPassages: number;
  toolSummaries: ChatToolCallSummary[];
  departmentScope?: string | string[] | undefined;
  errorMsg?: string | undefined;
  /** The turn's final answer text (fallback string on tool-cap; partial text on error). */
  finalContent: string;
}

/**
 * End-of-turn persistence (success or error): attach the turn summary to the final assistant
 * message (or insert an errored assistant row), auto-title from the first user message, and bump
 * the conversation's messageCount/lastMessageAt. Best-effort: never throws.
 */
async function finalizeTurn(
  ctx: TenantContext,
  conv: Conversation,
  userMessage: string,
  input: FinalizeInput,
): Promise<void> {
  const scope = input.departmentScope;
  const summary = {
    ragPassages: input.ragPassages,
    tools: input.toolSummaries,
    ...(scope !== undefined ? { departmentScope: scope } : {}),
  };
  try {
    if (input.errorMsg !== undefined) {
      // The turn threw — record an errored assistant row carrying whatever final text we have.
      await messageStore.appendAssistant(ctx, conv.id, {
        content: input.finalContent,
        error: input.errorMsg,
        ...summary,
      });
    } else if (input.lastAssistant && input.lastAssistant.content !== '') {
      // Normal case: the final answer is already a content-bearing row — just annotate it.
      await messageStore.annotateAssistant(ctx, input.lastAssistant.id, summary);
    } else {
      // Tool-iteration cap (or an empty final stub): the answer was streamed but never persisted
      // to a transcript-visible row. Insert it now so reload shows what the user saw.
      await messageStore.appendAssistant(ctx, conv.id, { content: input.finalContent, ...summary });
    }
    if (!conv.title) await conversationRepo.setTitle(ctx, conv.id, deriveTitle(userMessage));
    await conversationRepo.bumpForTurn(ctx, conv.id, { departmentScope: scope });
  } catch (err) {
    logger.warn({ err: errorMessage(err), conversationId: conv.id }, 'chat: finalizeTurn failed');
  }
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
    if (env.FF_AGENTIC_RAG) {
      // Multi-query CRAG loop with [Sn] citations (module enforces the same repo-level RBAC).
      const { agenticRetrieve } = await import('../knowledge/agentic/loop.js');
      const result = await agenticRetrieve(ctx, query, {
        k: DEFAULT_RETRIEVAL_K,
        allowWebFallback: Boolean(ctx.allDepartmentAccess),
      });
      if (result.passages.length === 0 && !result.webFallbackBlock && !result.notDocumented) {
        return null;
      }
      if (result.notDocumented && result.passages.length === 0 && !result.webFallbackBlock) {
        return {
          content:
            'CRAG: No reliable knowledge-base coverage. Tell the user the documentation does not specify — do not invent policy.',
          count: 0,
        };
      }
      return {
        content: result.groundingBlock,
        count: result.passages.length,
      };
    }
    const passages = await retrieve(ctx, query, DEFAULT_RETRIEVAL_K);
    if (passages.length === 0) return null;
    const body = passages
      .map((p, i) => `[#${i + 1} · doc ${p.docId} · score ${p.score.toFixed(3)}]\n${p.content}`)
      .join('\n\n');
    // Passages are retrieved DATA (a trust boundary): wrapped so injected instructions inert.
    return {
      content: `${knowledgeGroundingNote()}\n\n${wrapUntrusted('kb', body)}`,
      count: passages.length,
    };
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

/** Above this we don't attempt to unwrap; tool args are tiny in practice, so a huge blob is junk. */
const MAX_TOOL_ARG_LEN = 64_000;

/**
 * Some Groq-hosted models (gpt-oss/Llama) wrap tool-call JSON in a python tag, an XML-ish
 * `<function>…</function>` block, or a markdown fence. Strip those so we can recover the JSON.
 *
 * Only called as a *fallback* after a direct JSON.parse fails (see parseToolArgs) — clean JSON never
 * reaches here, so we can't corrupt valid arguments. Each unwrap is gated behind a cheap substring
 * check and uses indexOf/lastIndexOf slicing rather than greedy `[\s\S]*?` backtracking, so adversarial
 * unterminated input can't drive O(n²) regex work (ReDoS).
 */
function sanitizeToolArgs(raw: string): string {
  let s = raw.trim();
  if (s.length > MAX_TOOL_ARG_LEN) return s;
  if (s.includes('<|python_tag|>')) s = s.split('<|python_tag|>').join('').trim();
  // Unwrap <function ...>…</function> by slicing between the first '>' and the last closing tag.
  if (s.toLowerCase().startsWith('<function') && s.includes('</function>')) {
    const open = s.indexOf('>');
    const close = s.toLowerCase().lastIndexOf('</function>');
    if (open !== -1 && close > open) s = s.slice(open + 1, close).trim();
  }
  // Unwrap a ```…``` / ```json…``` fence by slicing between the first and last fence markers.
  if (s.startsWith('```')) {
    const close = s.lastIndexOf('```');
    if (close > 2) {
      let inner = s.slice(3, close);
      if (/^json\b/i.test(inner)) inner = inner.slice(4);
      s = inner.trim();
    }
  }
  return s;
}

/**
 * Parse tool-call arguments. Try the raw string first so valid JSON is never altered; only if that
 * fails do we attempt to unwrap model wrappers (gpt-oss/Llama) and parse again.
 */
function parseToolArgs(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(sanitizeToolArgs(raw));
  }
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
    args = parseToolArgs(toolCall.function.arguments);
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
): Promise<Message> {
  const input: Parameters<typeof messageStore.appendAssistant>[2] = { content, model };
  if (toolCalls.length > 0) input.toolCalls = toolCalls;
  if (usage) {
    input.promptTokens = usage.prompt_tokens;
    input.completionTokens = usage.completion_tokens;
  }
  return messageStore.appendAssistant(ctx, conversationId, input);
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
  const conv = await ensureConversation(ctx, conversationId, conversationMeta(ctx, opts));
  const convId = conv.id;
  await messageStore.appendUser(ctx, convId, userMessage, opts.departmentScope);

  const { messages, ragPassages } = await buildTurnMessages(ctx, convId, userMessage, opts.userName);
  const tools = buildTools(ctx);
  const turn = newTurnModel(opts.model);

  const usageAcc = { promptTokens: 0, completionTokens: 0, totalCost: 0 };
  const toolSummaries: ChatToolCallSummary[] = [];
  let finalContent = '';
  let lastAssistant: Message | undefined;
  let iterations = 0;

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
      iterations = i + 1;
      const completion = await createCompletion(turn, messages, tools);
      recordUsage(ctx, turn.model, completion.usage, usageAcc);

      const message = completion.choices[0]?.message;
      if (!message) throw new AppError('LLM returned no choices', { statusCode: 502 });
      const content = message.content ?? '';
      const toolCalls = message.tool_calls ?? [];

      lastAssistant = await persistAssistant(ctx, convId, content, toolCalls, turn.model, completion.usage);
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
  } catch (err) {
    await finalizeTurn(ctx, conv, userMessage, {
      lastAssistant,
      ragPassages,
      toolSummaries,
      departmentScope: opts.departmentScope,
      errorMsg: errorMessage(err),
      finalContent,
    });
    throw err;
  }

  await finalizeTurn(ctx, conv, userMessage, {
    lastAssistant,
    ragPassages,
    toolSummaries,
    departmentScope: opts.departmentScope,
    finalContent,
  });
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
  const conv = await ensureConversation(ctx, conversationId, conversationMeta(ctx, opts));
  const convId = conv.id;
  sse.send('start', { conversationId: convId });
  await messageStore.appendUser(ctx, convId, userMessage, opts.departmentScope);

  // Dynamic status: searching the knowledge base (real stage, no extra LLM).
  if (env.FF_RAG_ENABLED) {
    sse.send('status', { state: 'retrieving', label: 'Searching the knowledge base…' });
  }
  const { messages, ragPassages } = await buildTurnMessages(ctx, convId, userMessage, opts.userName);
  sse.send('context', { passages: ragPassages });
  const tools = buildTools(ctx);
  const turn = newTurnModel(opts.model);

  const usageAcc = { promptTokens: 0, completionTokens: 0, totalCost: 0 };
  const toolSummaries: ChatToolCallSummary[] = [];
  let finalContent = '';
  let lastAssistant: Message | undefined;
  let iterations = 0;

  try {
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
      const { content, toolCalls, usage } = await streamTurn(turn, messages, tools, sse);
      recordUsage(ctx, turn.model, usage, usageAcc);

      lastAssistant = await persistAssistant(ctx, convId, content, toolCalls, turn.model, usage);
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
  } catch (err) {
    await finalizeTurn(ctx, conv, userMessage, {
      lastAssistant,
      ragPassages,
      toolSummaries,
      departmentScope: opts.departmentScope,
      errorMsg: errorMessage(err),
      finalContent,
    });
    throw err;
  }

  await finalizeTurn(ctx, conv, userMessage, {
    lastAssistant,
    ragPassages,
    toolSummaries,
    departmentScope: opts.departmentScope,
    finalContent,
  });
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
