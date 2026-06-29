/**
 * Tools for the tool-caller-agent subagent. Each Octane operational tool in the registry is exposed
 * as a LangChain tool whose handler delegates to dispatchTool() — the single path that re-checks
 * RBAC, validates input/output, and writes the tool_calls + audit rows. So the DeepAgents stack
 * inherits the exact same access control and audit trail as the hand-rolled chat loop.
 *
 * The list is pre-filtered to what the caller may access (listForContext) and knowledge.search is
 * excluded (it belongs to the rag-agent). LangChain tool names can't contain '.', so registry names
 * like `zoho_crm.query` are exposed as `zoho_crm__query`; the real name is used for dispatch.
 */
import { tool, type StructuredTool } from '@langchain/core/tools';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { errorMessage } from '../../../lib/errors.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { dispatchTool } from '../../chat/toolDispatcher.js';
import { toolRegistry } from '../../tools/index.js';
import type { RegisteredTool } from '../../tools/types.js';
import { requireAgentContext } from '../context.js';

const EXCLUDED = new Set(['knowledge.search']);

/** LangChain/OpenAI tool names must match [a-zA-Z0-9_-]; map dotted registry names to '__'. */
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '__');
}

function toLangChainTool(rt: RegisteredTool): StructuredTool {
  return tool(
    async (input: Record<string, unknown>) => {
      const { ctx, conversationId } = requireAgentContext();
      try {
        const out = await dispatchTool(rt.name, input, ctx, conversationId ? { conversationId } : {});
        return typeof out === 'string' ? out : JSON.stringify(out);
      } catch (err) {
        // RBAC/validation/handler failures surface to the agent as text, not a thrown run.
        return `Tool ${rt.name} failed: ${errorMessage(err)}`;
      }
    },
    // Registry schemas are classic (v3) zod; convert to JSON Schema so LangChain v1 accepts them.
    { name: safeName(rt.name), description: rt.description, schema: zodToJsonSchema(rt.inputSchema) },
  ) as unknown as StructuredTool;
}

/** Operational tools the caller may access (RBAC), minus knowledge.search (the rag-agent's tool). */
export function buildToolCallerTools(ctx: TenantContext): StructuredTool[] {
  return toolRegistry
    .listForContext(ctx)
    .filter((rt) => !EXCLUDED.has(rt.name))
    .map(toLangChainTool);
}
