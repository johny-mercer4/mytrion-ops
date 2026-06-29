/**
 * Entry point for a single DeepAgents orchestrator turn. Binds the caller's security context for the
 * duration of the run (so RAG + tool-caller tools enforce RBAC), invokes the parent agent, and
 * returns the final assistant text. Stateless (no checkpointer) — one request, one answer.
 */
import type { BaseMessage } from '@langchain/core/messages';
import type { TenantContext } from '../../types/tenantContext.js';
import { runWithAgentContext } from './context.js';
import { buildDeepAgent } from './orchestrator.js';

export interface DeepAgentResult {
  answer: string;
}

function finalText(messages: BaseMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last) return '';
  if (typeof last.text === 'string' && last.text.trim()) return last.text;
  return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
}

export async function runDeepAgent(
  message: string,
  ctx: TenantContext,
  opts: { conversationId?: string } = {},
): Promise<DeepAgentResult> {
  return runWithAgentContext(
    { ctx, ...(opts.conversationId ? { conversationId: opts.conversationId } : {}) },
    async () => {
      const agent = await buildDeepAgent(ctx);
      const result = await agent.invoke({ messages: [{ role: 'user', content: message }] });
      return { answer: finalText(result.messages as BaseMessage[]) };
    },
  );
}
