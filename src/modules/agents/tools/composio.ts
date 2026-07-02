/**
 * Composio tools for child agents. `composio.tools.get` returns LangChain tools that Composio
 * executes REMOTELY (against the shared org connected account) — outside our toolDispatcher.
 * To honor the hard rules we:
 *   - gate exposure to admins (isComposioAllowed) — external toolkits include writes/deletes (#4/#7);
 *   - audit-log every remote execution via the afterExecute modifier (#8), reading the security
 *     context from the per-run AsyncLocalStorage and writing the same tool_calls + audit rows the
 *     native dispatcher does;
 *   - wrap the payload as UNTRUSTED external content before it reaches the model;
 *   - filter per agent manifest (composioToolkits) with longest-prefix toolkit matching, so e.g.
 *     'ZOHO' does not accidentally grant 'ZOHO_DESK' tools.
 */
import type { StructuredTool } from '@langchain/core/tools';
import type { ToolExecuteResponse } from '@composio/core';
import { env } from '../../../config/env.js';
import {
  COMPOSIO_ORG_USER,
  COMPOSIO_TOOLKITS,
  getComposio,
  isComposioAllowed,
} from '../../../integrations/composio.js';
import { logger } from '../../../lib/logger.js';
import { toolCallRepo } from '../../../repos/toolCallRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import { sanitizeToolResult, wrapUntrusted } from '../../security/untrusted.js';
import { requireAgentContext } from '../context.js';

// Composio tool slugs encode the verb (ZOHO_GET_CONTACT, ZOHO_DELETE_DEAL, ZOHO_DESK_UPDATE_TICKET).
// These verbs mutate state; everything else (get/list/search/download/count) is treated as read.
const WRITE_VERB = /(^|_)(create|update|delete|convert|upload|remove|add|send|set|upsert|merge|put|patch|post|assign|close|cancel)(_|$)/i;

/** Whether a Composio tool slug is a write/destructive action (vs a read). */
export function isComposioWriteTool(slug: string): boolean {
  return WRITE_VERB.test(slug);
}

/**
 * afterExecute modifier: audit-log each remote Composio call (never throws — audit must not
 * break runs), then wrap the payload as UNTRUSTED external content before it reaches the model.
 */
async function auditExecution(context: {
  toolSlug: string;
  toolkitSlug: string;
  result: ToolExecuteResponse;
}): Promise<ToolExecuteResponse> {
  const { toolSlug, toolkitSlug, result } = context;
  try {
    const { ctx, conversationId, agentRunId } = requireAgentContext();
    const status: 'ok' | 'error' = result?.successful ? 'ok' : 'error';
    const toolName = `composio:${toolSlug}`;
    await toolCallRepo.record({
      tenantId: ctx.tenantId,
      toolName,
      riskClass: isComposioWriteTool(toolSlug) ? 'write' : 'read',
      arguments: { toolkit: toolkitSlug },
      status,
      ...(status === 'error' && result?.error ? { errorMessage: String(result.error) } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(ctx.actingAgent ? { actingAgent: ctx.actingAgent } : {}),
      ...(agentRunId ? { agentRunId } : {}),
    });
    await auditFromContext(ctx, {
      action: 'tool.call',
      status,
      toolName,
      ...(agentRunId ? { agentRunId } : {}),
      detail: { toolkit: toolkitSlug, via: 'composio' },
    });
  } catch (err) {
    logger.warn({ err, toolSlug }, 'composio audit hook failed');
  }
  // External SaaS payloads are a trust boundary — the model receives them as inert data.
  return {
    ...result,
    data: { untrusted_content: wrapUntrusted('composio', sanitizeToolResult(result?.data)) },
  };
}

/**
 * Longest-prefix toolkit matching over the ENABLED toolkit set: a tool belongs to the most
 * specific enabled toolkit whose slug prefixes its name ('ZOHO_DESK_UPDATE_TICKET' → ZOHO_DESK,
 * not ZOHO). Returns whether that toolkit is in the agent's allowlist.
 */
export function toolAllowedForToolkits(toolSlug: string, allowed: string[], enabled: string[]): boolean {
  const upper = toolSlug.toUpperCase();
  let match = '';
  for (const toolkit of enabled) {
    const t = toolkit.toUpperCase();
    if ((upper === t || upper.startsWith(`${t}_`)) && t.length > match.length) match = t;
  }
  if (!match) return false;
  return allowed.some((a) => a.toUpperCase() === match);
}

/**
 * Build the admin-gated, audited Composio tools for the shared org account, filtered to the
 * given toolkit allowlist. Empty when not allowed / nothing matches. Read-only by default
 * (hard-rule #7): write/destructive tools are dropped unless FF_COMPOSIO_WRITES.
 */
export async function buildComposioToolsFor(
  ctx: TenantContext,
  allowedToolkits: string[],
): Promise<StructuredTool[]> {
  if (!isComposioAllowed(ctx) || COMPOSIO_TOOLKITS.length === 0) return [];
  const wanted = allowedToolkits.filter((t) =>
    COMPOSIO_TOOLKITS.some((enabled) => enabled.toUpperCase() === t.toUpperCase()),
  );
  if (wanted.length === 0) return [];
  const tools = await getComposio().tools.get(
    COMPOSIO_ORG_USER,
    { toolkits: wanted, limit: env.COMPOSIO_TOOL_LIMIT },
    { afterExecute: auditExecution },
  );
  // Composio's LangChain DynamicStructuredTools satisfy StructuredTool; cast across the (possibly
  // distinct) @langchain/core copies the two packages resolve.
  const all = tools as unknown as StructuredTool[];
  const scoped = all.filter((t) => toolAllowedForToolkits(t.name, wanted, COMPOSIO_TOOLKITS));
  if (env.FF_COMPOSIO_WRITES) return scoped;
  return scoped.filter((t) => !isComposioWriteTool(t.name));
}

/** All-enabled-toolkits variant (legacy external-tools behavior). */
export function buildComposioTools(ctx: TenantContext): Promise<StructuredTool[]> {
  return buildComposioToolsFor(ctx, [...COMPOSIO_TOOLKITS]);
}
