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

  const start = Date.now();
  try {
    const output = await tool.run(rawArgs, ctx);
    const durationMs = Date.now() - start;
    await recordToolCall(ctx, {
      ...baseEntry(toolName, args, tool.riskClass, opts),
      status: 'ok',
      result: output,
      durationMs,
    });
    await auditFromContext(ctx, {
      action: 'tool.call',
      status: 'ok',
      toolName,
      detail: { durationMs },
    });
    return output;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = errorMessage(err);
    await recordToolCall(ctx, {
      ...baseEntry(toolName, args, tool.riskClass, opts),
      status: 'error',
      errorMessage: message,
      durationMs,
    });
    await auditFromContext(ctx, {
      action: 'tool.call',
      status: 'error',
      toolName,
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
): Omit<NewToolCall, 'tenantId' | 'status'> {
  const entry: Omit<NewToolCall, 'tenantId' | 'status'> = {
    toolName,
    riskClass,
    arguments: args,
  };
  if (opts.conversationId !== undefined) entry.conversationId = opts.conversationId;
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
    ...baseEntry(toolName, args, riskClass, opts),
    status: 'denied',
    ...(reason !== undefined ? { errorMessage: reason } : {}),
  });
  await auditFromContext(ctx, {
    action: 'tool.call',
    status: 'denied',
    toolName,
    ...(reason !== undefined ? { detail: { reason } } : {}),
  });
}
