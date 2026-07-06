/**
 * Per-run security context for the multi-agent stack. LangChain `tool()` handlers don't receive
 * our TenantContext through their signature, so we stash it in an AsyncLocalStorage for the
 * duration of a single agent invocation. Every RAG/tool wrapper reads it back to enforce RBAC +
 * tenant isolation (via retrieve()/dispatchTool()) — exactly as the hand-rolled chat loop does.
 *
 * The store also carries the run's BudgetMeter and agent_runs id so tool wrappers can count
 * calls and stamp attribution without threading extra parameters through LangChain.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from '../../types/tenantContext.js';
import type { WireCitation } from '../../modules/knowledge/agentic/citationCheck.js';
import type { BudgetMeter } from './budget.js';
import type { ElicitationHolder } from './elicitation.js';

/** Everything tools/compilers report back out of a run besides the answer itself. */
export interface RunCollector extends ElicitationHolder {
  /** RAG citations gathered by knowledge_search calls (validated post-run). */
  citations?: WireCitation[];
  /** Passages retrieved across the run (the widget's "grounded in N passages" count). */
  ragPassages?: number;
  /** Degradations worth surfacing (e.g. Composio tools failed to build). */
  warnings?: string[];
}

export interface AgentRunContext {
  ctx: TenantContext;
  conversationId?: string;
  /** Per-run budget guard; tool wrappers call countToolCall() when present. */
  budget?: BudgetMeter;
  /** agent_runs.id for this run — stamped onto tool_calls/audit rows. */
  agentRunId?: string;
  /** Collects generative-UI choices, citations, and warnings; surfaced on the turn result. */
  collect?: RunCollector;
  /** Emit an SSE event mid-run (absent on non-stream turns). */
  emit?: (event: string, data: unknown) => void;
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
    throw new Error('Agent tool invoked outside of an agent run context');
  }
  return current;
}

/**
 * Soft variant for code that also runs outside a turn (e.g. agent compilation in tests or
 * warm-up paths) — reporting hooks no-op instead of throwing.
 */
export function getAgentContext(): AgentRunContext | undefined {
  return storage.getStore();
}
