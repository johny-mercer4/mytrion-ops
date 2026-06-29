/**
 * Per-run security context for the DeepAgents stack. LangChain `tool()` handlers don't receive our
 * TenantContext through their signature, so we stash it in an AsyncLocalStorage for the duration of
 * a single agent invocation. Every RAG/tool-caller tool reads it back to enforce RBAC + tenant
 * isolation (via retrieve()/dispatchTool()) — exactly as the hand-rolled chat loop does.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from '../../types/tenantContext.js';

export interface AgentRunContext {
  ctx: TenantContext;
  conversationId?: string;
}

const storage = new AsyncLocalStorage<AgentRunContext>();

/** Run `fn` (the whole agent invocation) with the given security context bound. */
export function runWithAgentContext<T>(run: AgentRunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(run, fn);
}

/** Read the bound context inside a tool handler. Throws if called outside a run (programmer error). */
export function requireAgentContext(): AgentRunContext {
  const current = storage.getStore();
  if (!current) {
    throw new Error('DeepAgent tool invoked outside of an agent run context');
  }
  return current;
}
