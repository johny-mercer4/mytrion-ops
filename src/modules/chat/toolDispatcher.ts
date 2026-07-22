import { ZodError } from 'zod';
import { env } from '../../config/env.js';
import type { NewToolCall } from '../../db/schema/index.js';
import { errorMessage, RBACError, ToolError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { toolCallRepo } from '../../repos/toolCallRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { toolRegistry } from '../tools/index.js';

export interface DispatchOptions {
  conversationId?: string;
  /**
   * Read-only dispatch (read-only agents like analyst/manager): any non-read tool is denied
   * here even if the caller's role would allow it — defense in depth behind the tool-binding
   * filter, since a model can name tools it was never bound to.
   */
  readOnly?: boolean;
  /** Attribution override; defaults to ctx.actingAgent (set by authority.narrowContext). */
  actingAgent?: string;
  /** Groups all tool calls of one orchestrator/child run (agent_runs.id). */
  agentRunId?: string;
  /**
   * The call was proposed by an AGENT (model decision), not direct API usage. With
   * FF_WRITE_APPROVALS on, non-read tools park as a pending approval instead of executing.
   */
  viaAgent?: boolean;
}

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Park an agent-proposed write as a pending approval. The proposal is only parked when the
 * proposer is ALREADY authorized (checkAccess ran first) — an agent can't queue what its
 * principal couldn't do; approval adds a human gate on top, never authority.
 */
async function requestApproval(
  ctx: TenantContext,
  toolName: string,
  riskClass: 'write' | 'destructive',
  args: Record<string, unknown>,
  opts: DispatchOptions,
): Promise<unknown> {
  const { approvalRepo } = await import('../../repos/approvalRepo.js');
  const { tenantContextSchema } = await import('../jobs/catalog.js');
  const snapshot = tenantContextSchema.parse(ctx) as Record<string, unknown>;
  const actingAgent = opts.actingAgent ?? ctx.actingAgent;
  const approval = await approvalRepo.create(ctx, {
    requestedBy: ctx.userId,
    ...(actingAgent !== undefined ? { actingAgent } : {}),
    ...(opts.agentRunId ? { agentRunId: opts.agentRunId } : {}),
    ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    toolName,
    riskClass,
    arguments: args,
    ctxSnapshot: snapshot,
    expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
  });
  await auditFromContext(ctx, {
    action: 'tool.approval_requested',
    status: 'ok',
    toolName,
    ...(opts.agentRunId !== undefined ? { agentRunId: opts.agentRunId } : {}),
    detail: { approvalId: approval.id, riskClass },
  });
  return {
    status: 'pending_approval',
    pendingApprovalId: approval.id,
    message:
      `This ${riskClass} action requires human approval. It has been queued as approval ` +
      `${approval.id} (expires in 24h). Tell the user an admin must approve it at /v1/approvals.`,
  };
}

function toArgsRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    // Narrowed to a plain object; tool args from OpenAI are always JSON objects.
    return raw as Record<string, unknown>;
  }
  return { value: raw };
}

async function recordToolCall(
  ctx: TenantContext,
  entry: Omit<NewToolCall, 'tenantId'>,
): Promise<void> {
  try {
    await toolCallRepo.record({ tenantId: ctx.tenantId, ...entry });
  } catch (err) {
    logger.error({ err, toolName: entry.toolName }, 'failed to persist tool_call');
  }
}

/**
 * Resolve a tool by name, re-check RBAC server-side, validate input/output, run it,
 * and record a tool_calls row + audit entry. This is the ONLY path tools execute
 * through — the chat loop never calls a handler directly. Throws RBACError (denied),
 * ValidationError (bad args), or ToolError (handler/unknown failure).
 */
export async function dispatchTool(
  toolName: string,
  rawArgs: unknown,
  ctx: TenantContext,
  opts: DispatchOptions = {},
): Promise<unknown> {
  const args = toArgsRecord(rawArgs);
  const tool = toolRegistry.get(toolName);

  if (!tool) {
    await recordDenied(ctx, toolName, args, 'read', opts, 'unknown tool');
    throw new ToolError(`Unknown tool: ${toolName}`);
  }

  const access = toolRegistry.checkAccess(tool, ctx);
  if (!access.ok) {
    await recordDenied(ctx, toolName, args, tool.riskClass, opts, access.reason);
    throw new RBACError(access.reason ?? `Access to ${toolName} denied`);
  }

  if (opts.readOnly && tool.riskClass !== 'read') {
    const reason = `tool '${toolName}' is ${tool.riskClass}-risk and this agent context is read-only`;
    await recordDenied(ctx, toolName, args, tool.riskClass, opts, reason);
    throw new RBACError(reason);
  }

  if (env.FF_WRITE_APPROVALS && opts.viaAgent && tool.riskClass !== 'read') {
    return requestApproval(ctx, toolName, tool.riskClass, args, opts);
  }

  const start = Date.now();
  try {
    const output = await tool.run(rawArgs, ctx);
    const durationMs = Date.now() - start;
    await recordToolCall(ctx, {
      ...baseEntry(toolName, args, tool.riskClass, opts, ctx),
      status: 'ok',
      result: output,
      durationMs,
    });
    await auditFromContext(ctx, {
      action: 'tool.call',
      status: 'ok',
      toolName,
      ...(opts.agentRunId !== undefined ? { agentRunId: opts.agentRunId } : {}),
      detail: { durationMs },
    });
    return output;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = errorMessage(err);
    const isHallucination = err instanceof ZodError;
    await recordToolCall(ctx, {
      ...baseEntry(toolName, args, tool.riskClass, opts, ctx),
      status: 'error',
      errorMessage: message,
      durationMs,
    });
    await auditFromContext(ctx, {
      action: 'tool.call',
      status: 'error',
      toolName,
      ...(opts.agentRunId !== undefined ? { agentRunId: opts.agentRunId } : {}),
      detail: { error: message, ...(isHallucination ? { hallucination: true } : { resolutionError: true }) },
    });
    if (isHallucination) {
      throw new ValidationError(`Invalid arguments for ${toolName}`, { details: err.flatten() });
    }
    throw new ToolError(`Tool ${toolName} failed: ${message}`, { cause: err });
  }
}

function baseEntry(
  toolName: string,
  args: Record<string, unknown>,
  riskClass: NewToolCall['riskClass'],
  opts: DispatchOptions,
  ctx: TenantContext,
): Omit<NewToolCall, 'tenantId' | 'status'> {
  const entry: Omit<NewToolCall, 'tenantId' | 'status'> = {
    toolName,
    riskClass,
    arguments: args,
  };
  if (opts.conversationId !== undefined) entry.conversationId = opts.conversationId;
  const actingAgent = opts.actingAgent ?? ctx.actingAgent;
  if (actingAgent !== undefined) entry.actingAgent = actingAgent;
  if (opts.agentRunId !== undefined) entry.agentRunId = opts.agentRunId;
  return entry;
}

async function recordDenied(
  ctx: TenantContext,
  toolName: string,
  args: Record<string, unknown>,
  riskClass: NewToolCall['riskClass'],
  opts: DispatchOptions,
  reason?: string,
): Promise<void> {
  await recordToolCall(ctx, {
    ...baseEntry(toolName, args, riskClass, opts, ctx),
    status: 'denied',
    ...(reason !== undefined ? { errorMessage: reason } : {}),
  });
  await auditFromContext(ctx, {
    action: 'tool.call',
    status: 'denied',
    toolName,
    ...(opts.agentRunId !== undefined ? { agentRunId: opts.agentRunId } : {}),
    ...(reason !== undefined ? { detail: { reason } } : {}),
  });
}
