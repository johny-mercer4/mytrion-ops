import { ZodError } from 'zod';
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
      detail: { error: message },
    });
    if (err instanceof ZodError) {
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
