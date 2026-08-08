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
import { getAgentContext, requireAgentContext } from '../context.js';
import { coerceElicitation } from '../elicitation.js';
import type { AgentManifest } from '../types.js';

/** LangChain/OpenAI tool names must match [a-zA-Z0-9_-]; map dotted registry names to '__'. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '__');
}

/**
 * The parameter schema OpenAI gets for one tool. Two things must hold, and BOTH were broken for
 * MCP-backed tools:
 *
 *  - MCP tools declare `inputSchema: z.unknown()` because the MCP server validates arguments; their
 *    real JSON Schema lives on `rawParameters`. Deriving from the zod schema therefore threw the
 *    actual parameters away, so the model could never fill them in.
 *  - `zodToJsonSchema(z.unknown())` is `{}` — no `type`. OpenAI requires a function's parameters to
 *    be `type: "object"` and rejects the ENTIRE request otherwise, reporting the missing key as
 *    `got 'type: "None"'`. One such tool in the bound set failed every agent turn with
 *    "The AI service failed to complete this request", whatever the user asked.
 *
 * So: prefer the tool's own JSON Schema, and guarantee an object-typed root either way.
 */
export function openAiToolSchema(rt: RegisteredTool): Record<string, unknown> {
  const raw = rt.rawParameters;
  const derived: unknown = raw && Object.keys(raw).length > 0 ? raw : zodToJsonSchema(rt.inputSchema);
  const base: Record<string, unknown> =
    typeof derived === 'object' && derived !== null && !Array.isArray(derived)
      ? (derived as Record<string, unknown>)
      : {};
  if (base['type'] === 'object') return base;
  // A non-object root (or none at all) cannot describe named arguments — present it as an empty
  // object schema rather than letting it invalidate the whole request.
  const properties =
    typeof base['properties'] === 'object' && base['properties'] !== null
      ? base['properties']
      : {};
  return { ...base, type: 'object', properties };
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
    { name: safeName(rt.name), description: rt.description, schema: openAiToolSchema(rt) },
  ) as unknown as StructuredTool; // JSON-schema tool() overload returns a compatible runtime tool
}

/**
 * The bound tool set for one child agent under an already-NARROWED context.
 * knowledge_search is excluded here — the scoped RAG tool covers it per agent.
 */
export function buildAgentTools(manifest: AgentManifest, narrowedCtx: TenantContext): StructuredTool[] {
  const bound = toolRegistry
    .listForContext(narrowedCtx)
    .filter((rt) => manifest.tools.some((t) => t === rt.name || (t.endsWith('.*') && rt.name.startsWith(t.slice(0, -1)))))
    .filter((rt) => rt.name !== 'knowledge.search')
    .filter((rt) => !manifest.readOnly || rt.riskClass === 'read');

  /**
   * Surface how many tools this agent is carrying. Every bound schema is input tokens on every model
   * call in the turn, and a wildcard once put ~102 of them on Sales — 71k input tokens per call, which
   * spent the org's whole per-minute quota in about 1.4 questions and returned 429s the UI showed as
   * "network error". That took a night of measurement to find because nothing reported this number.
   * Now the Turn Inspector shows it.
   */
  getAgentContext()?.inspect?.({
    stage: 'agent',
    status: 'complete',
    label: `${manifest.label} bound ${bound.length} tools`,
    agent: manifest.key,
    details: {
      toolsBound: bound.length,
      writeTools: bound.filter((rt) => rt.riskClass !== 'read').length,
    },
  });

  return bound.map((rt) => toLangChainTool(rt, manifest, narrowedCtx));
}
