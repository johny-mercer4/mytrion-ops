/**
 * Manifest → runtime compiler. The deepagents harness stays generic (planning via write_todos,
 * context-isolated task delegation, summarization); everything Octane-specific comes from the
 * AgentManifest registry, compiled per request AFTER RBAC filtering — a caller's orchestrator
 * literally does not contain agents outside their departments. This file is the single seam
 * that touches deepagents' API (the package is pinned exactly for that reason).
 */
import { createDeepAgent, type SubAgent } from 'deepagents';
import type { StructuredTool } from '@langchain/core/tools';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { agentRegistry } from './agentRegistry.js';
import { narrowContext } from './authority.js';
import { getCheckpointer } from './checkpointer.js';
import { resolveAgentModel, resolveOrchestratorModel } from './models.js';
import { childSystemPrompt, ORCHESTRATOR_PROMPT } from './prompts.js';
import { agentResultSchema } from './resultSchema.js';
import { buildAgentTools } from './tools/agentTools.js';
import { buildBrowserTools } from './tools/browserTools.js';
import { buildComposioToolsFor } from './tools/composio.js';
import { buildScopedRagTool } from './tools/scopedRag.js';
import { webSearchTool } from './tools/webSearch.js';
import type { AgentManifest } from './types.js';

/** All tools one child agent gets: scoped RAG + (RBAC ∩ allowlist) registry tools + extras. */
async function childTools(manifest: AgentManifest, callerCtx: TenantContext): Promise<StructuredTool[]> {
  const narrowed = narrowContext(callerCtx, manifest);
  const tools: StructuredTool[] = [
    buildScopedRagTool(manifest, callerCtx),
    ...buildAgentTools(manifest, narrowed),
  ];
  if (manifest.webSearch) tools.push(webSearchTool);
  if (manifest.browser) tools.push(...(await buildBrowserTools(narrowed)));
  if (manifest.composioToolkits.length > 0) {
    try {
      tools.push(...(await buildComposioToolsFor(narrowed, manifest.composioToolkits)));
    } catch (err) {
      // Composio being unreachable/misconfigured must never take down agent construction.
      logger.warn({ err, agent: manifest.key }, 'composio tools unavailable; continuing without');
    }
  }
  return tools;
}

/** Compile one manifest into a deepagents SubAgent (fresh context, structured AgentResult back). */
async function compileSubAgent(manifest: AgentManifest, callerCtx: TenantContext): Promise<SubAgent> {
  return {
    name: manifest.key,
    description: manifest.description,
    systemPrompt: childSystemPrompt(manifest),
    tools: await childTools(manifest, callerCtx),
    model: resolveAgentModel(manifest),
    responseFormat: agentResultSchema,
  };
}

/** The parent orchestrator over the caller's RBAC-filtered agents. */
export async function buildOrchestrator(callerCtx: TenantContext): Promise<{
  agent: ReturnType<typeof createDeepAgent>;
  agentKeys: string[];
}> {
  const manifests = agentRegistry.listForContext(callerCtx);
  const subagents = await Promise.all(manifests.map((m) => compileSubAgent(m, callerCtx)));
  const checkpointer = getCheckpointer();
  const agent = createDeepAgent({
    model: resolveOrchestratorModel(),
    systemPrompt: ORCHESTRATOR_PROMPT,
    subagents,
    ...(checkpointer ? { checkpointer } : {}),
  });
  return { agent, agentKeys: manifests.map((m) => m.key) };
}

/**
 * Direct-to-child mode: one department agent, no orchestrator hop (used when the web app is
 * already inside a department Mytrion). Same tools/persona/narrowing; the final answer goes
 * straight to the user, so no structured responseFormat here.
 */
export async function buildSingleAgent(
  manifest: AgentManifest,
  callerCtx: TenantContext,
): Promise<ReturnType<typeof createDeepAgent>> {
  const checkpointer = getCheckpointer();
  return createDeepAgent({
    model: resolveAgentModel(manifest),
    systemPrompt: childSystemPrompt(manifest),
    tools: await childTools(manifest, callerCtx),
    ...(checkpointer ? { checkpointer } : {}),
  });
}
