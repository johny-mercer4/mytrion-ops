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
import { env } from '../../config/env.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { agentRegistry } from './agentRegistry.js';
import { narrowContext } from './authority.js';
import { getAgentContext } from './context.js';
import { getCheckpointer } from './checkpointer.js';
import { getCachedAgent, identitySignature } from './graphCache.js';
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
  if (manifest.browser) {
    tools.push(...(await buildBrowserTools(narrowed, { readOnly: manifest.readOnly })));
  }
  if (env.FF_COMPOSIO_ENABLED && manifest.composioToolkits.length > 0) {
    try {
      // Read-only agents (manager) get read Composio tools only, regardless of FF_COMPOSIO_WRITES —
      // Composio executes remotely, so binding-time stripping is the only enforcement point.
      tools.push(
        ...(await buildComposioToolsFor(narrowed, manifest.composioToolkits, {
          ...(manifest.readOnly ? { readOnly: true } : {}),
        })),
      );
    } catch (err) {
      // Composio being unreachable/misconfigured must never take down agent construction —
      // but the degradation must not be silent either: report it onto the run so the turn
      // can tell the user/audit that external tools were missing.
      logger.warn({ err, agent: manifest.key }, 'composio tools unavailable; continuing without');
      const run = getAgentContext();
      if (run?.collect) {
        (run.collect.warnings ??= []).push(
          `External (Composio) tools were unavailable for the ${manifest.label} agent this turn.`,
        );
      }
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
  // Cache keyed by the caller's full identity/scope: two callers never share a graph, and the same
  // caller (same department view) reuses it across turns. See graphCache.ts for the safety contract.
  return getCachedAgent(`orch:${identitySignature(callerCtx)}`, async () => {
    const manifests = agentRegistry.listForContext(callerCtx);
    const subagents = await Promise.all(manifests.map((m) => compileSubAgent(m, callerCtx)));
    const checkpointer = getCheckpointer();
    const agent = createDeepAgent({
      model: resolveOrchestratorModel(),
      systemPrompt: ORCHESTRATOR_PROMPT,
      subagents,
      ...(checkpointer ? { checkpointer } : {}),
      middleware: [],
    });
    return { agent, agentKeys: manifests.map((m) => m.key) };
  });
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
  return getCachedAgent(`single:${manifest.key}:${identitySignature(callerCtx)}`, async () => {
    const checkpointer = getCheckpointer();
    return createDeepAgent({
      model: resolveAgentModel(manifest),
      systemPrompt: childSystemPrompt(manifest),
      tools: await childTools(manifest, callerCtx),
      ...(checkpointer ? { checkpointer } : {}),
      middleware: [],
    });
  });
}
