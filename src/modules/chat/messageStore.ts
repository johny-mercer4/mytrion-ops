import type OpenAI from 'openai';
import { DEFAULT_HISTORY_TURNS } from '../../config/constants.js';
import type { Message } from '../../db/schema/index.js';
import { messageRepo } from '../../repos/messageRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type AssistantMessage = OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall;

/** Convert a stored message row into an OpenAI chat message (or null to drop it). */
export function dbMessageToOpenAi(msg: Message): ChatMessage | null {
  switch (msg.role) {
    case 'system':
      return { role: 'system', content: msg.content };
    case 'user':
      return { role: 'user', content: msg.content };
    case 'assistant': {
      const assistant: AssistantMessage = {
        role: 'assistant',
        content: msg.content.length > 0 ? msg.content : null,
      };
      if (msg.toolCalls) {
        // Stored verbatim from the API on the way in; safe to replay.
        assistant.tool_calls = msg.toolCalls as ToolCall[];
      }
      return assistant;
    }
    case 'tool':
      if (!msg.toolCallId) return null;
      return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.content };
    default:
      return null;
  }
}

export interface AssistantPersistInput {
  content: string;
  toolCalls?: ToolCall[];
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export const messageStore = {
  appendUser(ctx: TenantContext, conversationId: string, content: string): Promise<Message> {
    return messageRepo.append(ctx, { conversationId, role: 'user', content });
  },

  appendAssistant(
    ctx: TenantContext,
    conversationId: string,
    input: AssistantPersistInput,
  ): Promise<Message> {
    return messageRepo.append(ctx, {
      conversationId,
      role: 'assistant',
      content: input.content,
      ...(input.toolCalls && input.toolCalls.length > 0 ? { toolCalls: input.toolCalls } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.promptTokens !== undefined ? { promptTokens: input.promptTokens } : {}),
      ...(input.completionTokens !== undefined ? { completionTokens: input.completionTokens } : {}),
    });
  },

  appendToolResult(
    ctx: TenantContext,
    conversationId: string,
    input: { toolCallId: string; name: string; content: string },
  ): Promise<Message> {
    return messageRepo.append(ctx, {
      conversationId,
      role: 'tool',
      content: input.content,
      toolCallId: input.toolCallId,
      name: input.name,
    });
  },

  /**
   * Load recent history as OpenAI messages. Leading 'tool' messages (whose parent
   * assistant fell outside the window) are dropped so the sequence is valid for the API.
   */
  async loadHistory(
    ctx: TenantContext,
    conversationId: string,
    limit: number = DEFAULT_HISTORY_TURNS,
  ): Promise<ChatMessage[]> {
    const rows = await messageRepo.recent(ctx, conversationId, limit);
    const converted = rows
      .map(dbMessageToOpenAi)
      .filter((m): m is ChatMessage => m !== null);
    let start = 0;
    while (start < converted.length && converted[start]?.role === 'tool') start += 1;
    return converted.slice(start);
  },
};
