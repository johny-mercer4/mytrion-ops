/**
 * The three child subagents the orchestrator delegates to. Each is a declarative DeepAgents SubAgent
 * (fresh context window, single hand-off back to the parent):
 *   rag-agent         — internal knowledge base (pgvector RAG)
 *   web-search-agent  — public web (OpenAI web search)
 *   tool-caller-agent — live Octane operational tools (Zoho CRM/Desk/People, debtors, sales, …)
 * The tool-caller's tools are built per request so they're scoped to the caller's RBAC.
 */
import type { SubAgent } from 'deepagents';
import type { TenantContext } from '../../types/tenantContext.js';
import { ragTool } from './tools/rag.js';
import { buildToolCallerTools } from './tools/toolCaller.js';
import { webSearchTool } from './tools/webSearch.js';

export function ragSubagent(): SubAgent {
  return {
    name: 'rag-agent',
    description:
      'Answers questions from the internal Octane knowledge base (policies, products, pricing, ' +
      'procedures). Delegate any internal/company-knowledge question here, one focused question at a time.',
    systemPrompt:
      'You are the RAG specialist. Call knowledge_search to find relevant passages, then answer ONLY ' +
      'from those passages and cite the docId. If nothing relevant is found, say so plainly — never invent facts.',
    tools: [ragTool],
  };
}

export function webSearchSubagent(): SubAgent {
  return {
    name: 'web-search-agent',
    description:
      'Searches the public web for current or external information not found in the internal ' +
      'knowledge base. Delegate one focused query at a time.',
    systemPrompt:
      'You are the web research specialist. Use internet_search for external/current information. ' +
      'Summarize concisely and make clear the information comes from the public web.',
    tools: [webSearchTool],
  };
}

export function toolCallerSubagent(ctx: TenantContext): SubAgent {
  return {
    name: 'tool-caller-agent',
    description:
      'Calls Octane operational tools (Zoho CRM/Desk/People, debtors, sales snapshots, activity, …) ' +
      'to fetch live data. Delegate data-fetching requests here.',
    systemPrompt:
      'You are the operational-tools specialist. Use the available tools to fetch exactly what was ' +
      'asked. Every tool call is RBAC-checked and audit-logged server-side; if a tool returns an access ' +
      'or validation error, report it plainly rather than guessing. Return the data you retrieved.',
    tools: buildToolCallerTools(ctx),
  };
}
