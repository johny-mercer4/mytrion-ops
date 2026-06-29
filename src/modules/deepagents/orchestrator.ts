/**
 * The parent orchestrator. A DeepAgents harness (planning via write_todos, context-isolated
 * subagents, summarization) on top of our OpenAI model, delegating to the three children. Built
 * per request so the tool-caller's tools are scoped to the caller's RBAC.
 */
import { createDeepAgent, type SubAgent } from 'deepagents';
import { env } from '../../config/env.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { makeChatModel } from './model.js';
import { externalToolsSubagent, ragSubagent, toolCallerSubagent, webSearchSubagent } from './subagents.js';

const ORCHESTRATOR_PROMPT = `You are the Octane operations orchestrator. You coordinate specialist subagents and synthesize a single, accurate answer for the user.

Delegate via the task tool:
- Internal company knowledge (policy, product, pricing, how-to) -> rag-agent
- Public web / current external information -> web-search-agent
- Live operational data from Octane's native tools (Zoho CRM/Desk/People, debtors, sales snapshots, activity) -> tool-caller-agent
- External SaaS app actions through Composio (Zoho CRM/Desk via the org connection) -> external-tools-agent (only if present)

For multi-step requests, use write_todos to plan first. Prefer rag-agent and tool-caller-agent for internal needs; use web-search-agent only for genuinely external/current information. Never fabricate data or tool results — if a specialist cannot find something, say so. Finish with one clear, concise answer.`;

export async function buildDeepAgent(ctx: TenantContext) {
  const subagents: SubAgent[] = [ragSubagent(), webSearchSubagent(), toolCallerSubagent(ctx)];
  if (env.FF_COMPOSIO_ENABLED) {
    const external = await externalToolsSubagent(ctx);
    if (external) subagents.push(external);
  }
  return createDeepAgent({
    model: makeChatModel(),
    systemPrompt: ORCHESTRATOR_PROMPT,
    subagents,
  });
}
