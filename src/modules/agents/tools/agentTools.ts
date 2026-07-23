/**
 * Registry tools for one child agent: RBAC listForContext(narrowed ctx) ∩ the manifest's
 * allowlist, each wrapped as a LangChain tool whose handler goes through dispatchTool() — the
 * single path that re-checks RBAC, validates input/output, and writes tool_calls + audit rows
 * (now stamped with actingAgent/agentRunId). Read-only manifests both strip non-read tools at
 * binding AND dispatch with readOnly (defense in depth). Outputs are size-capped so one chatty
 * tool can't flood a child context; every call counts against the run's BudgetMeter.
 */
import { tool, type StructuredTool } from '@langchain/core/tools';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from '../../../config/env.js';
import { errorMessage } from '../../../lib/errors.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { dispatchTool } from '../../chat/toolDispatcher.js';
import { sanitizeToolResult } from '../../security/untrusted.js';
import { toolRegistry } from '../../tools/index.js';
import type { RegisteredTool } from '../../tools/types.js';
import { BudgetExceededError } from '../budget.js';
import { requireAgentContext } from '../context.js';
import { coerceElicitation } from '../elicitation.js';
import type { AgentManifest } from '../types.js';

/** LangChain/OpenAI tool names must match [a-zA-Z0-9_-]; map dotted registry names to '__'. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '__');
}

function toLangChainTool(
  rt: RegisteredTool,
  manifest: AgentManifest,
  narrowedCtx: TenantContext,
): StructuredTool {
  return tool(
    async (input: Record<string, unknown>) => {
      // Run bookkeeping (conversation/budget/run id) comes from the ALS store, but dispatch
      // authority is the NARROWED context captured at build time — the child never executes
      // with the caller's wider departments/bypass, even if the ALS ctx is broader.
      const runCtx = requireAgentContext();
      const { conversationId, budget, agentRunId } = runCtx;
      budget?.countToolCall(); // throws BudgetExceededError → aborts the run
      // requestId is the one ephemeral field: take it from THIS turn's run context so a cached/reused
      // graph never stamps a stale requestId on audit rows. Identity/authority stays the narrowed ctx.
      const freshRequestId = runCtx.ctx?.requestId;
      const dispatchCtx: TenantContext =
        freshRequestId && freshRequestId !== narrowedCtx.requestId
          ? { ...narrowedCtx, requestId: freshRequestId }
          : narrowedCtx;
      try {
        const out = await dispatchTool(rt.name, input, dispatchCtx, {
          ...(conversationId ? { conversationId } : {}),
          ...(agentRunId ? { agentRunId } : {}),
          ...(manifest.readOnly ? { readOnly: true } : {}),
          viaAgent: true,
        });
        // A tool asking the user to choose returns an `elicitation` — stash it for the frontend
        // (server-built options; the model gets a short confirmation, not the full list).
        if (out && typeof out === 'object' && 'elicitation' in out && runCtx.collect) {
          const e = coerceElicitation((out as { elicitation?: unknown }).elicitation);
          if (e) {
            runCtx.collect.elicitation = e;
            return (
              `A selection UI with ${e.options.length} option(s) for "${e.field}" has ALREADY been ` +
              'shown to the user. Do NOT call another tool to present options, do NOT list or invent ' +
              'the options in your reply. Simply ask the user to pick from the list shown, then STOP — ' +
              'their choice arrives as the next message.'
            );
          }
        }
        return sanitizeToolResult(out, env.AGENT_TOOL_OUTPUT_MAX_CHARS);
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        // RBAC/validation/handler failures surface to the agent as text, not a thrown run.
        return `Tool ${rt.name} failed: ${errorMessage(err)}`;
      }
    },
    // Registry schemas are classic (v3) zod; convert to JSON Schema so LangChain v1 accepts them.
    { name: safeName(rt.name), description: rt.description, schema: zodToJsonSchema(rt.inputSchema) },
  ) as unknown as StructuredTool; // JSON-schema tool() overload returns a compatible runtime tool
}

/**
 * The bound tool set for one child agent under an already-NARROWED context.
 * knowledge_search is excluded here — the scoped RAG tool covers it per agent.
 */
export function buildAgentTools(manifest: AgentManifest, narrowedCtx: TenantContext): StructuredTool[] {
  return toolRegistry
    .listForContext(narrowedCtx)
    .filter((rt) => manifest.tools.some((t) => t === rt.name || (t.endsWith('.*') && rt.name.startsWith(t.slice(0, -1)))))
    .filter((rt) => rt.name !== 'knowledge.search')
    .filter((rt) => !manifest.readOnly || rt.riskClass === 'read')
    .map((rt) => toLangChainTool(rt, manifest, narrowedCtx));
}
