/**
 * The parent orchestrator. A DeepAgents harness (planning via write_todos, context-isolated
 * subagents, summarization) on top of our OpenAI model, delegating to the three children. Built
 * per request so the tool-caller's tools are scoped to the caller's RBAC.
 */
import { createDeepAgent } from 'deepagents';
import type { TenantContext } from '../../types/tenantContext.js';
import { makeChatModel } from './model.js';
import { ragSubagent, toolCallerSubagent, webSearchSubagent } from './subagents.js';

const ORCHESTRATOR_PROMPT = `You are the Octane operations orchestrator. You coordinate three specialists and synthesize a single, accurate answer for the user.

Delegate via the task tool:
- Internal company knowledge (policy, product, pricing, how-to) -> rag-agent
- Public web / current external information -> web-search-agent
- Live operational data from Octane systems (Zoho CRM/Desk/People, debtors, sales snapshots, activity) -> tool-caller-agent

For multi-step requests, use write_todos to plan first. Prefer the rag-agent and tool-caller-agent for anything internal; only use web-search-agent for genuinely external/current information. Never fabricate data or tool results — if a specialist cannot find something, say so. Finish with one clear, concise answer.`;

export function buildDeepAgent(ctx: TenantContext) {
  return createDeepAgent({
    model: makeChatModel(),
    systemPrompt: ORCHESTRATOR_PROMPT,
    subagents: [ragSubagent(), webSearchSubagent(), toolCallerSubagent(ctx)],
  });
}
