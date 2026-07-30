import { z, type ZodRawShape } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { incrementCounter } from './metrics.js';
import { isToolEnabled, serviceForTool } from './serviceRegistry.js';
import {
  isToolAllowedForRole,
  type GatewayRole,
} from './skillRegistry.js';

export type RiskClass = 'read' | 'write';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolManifest {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskClass: RiskClass;
  /** State-changing tools remain hidden until Telegram supplies a trusted confirmation tap. */
  confirmationMode?: 'trusted_button';
  /** UX hints may be called automatically, but must never invalidate completed business work. */
  requirementMode?: 'must' | 'best_effort';
  authorize?: (input: Record<string, unknown>) => string | null;
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolAuditContext {
  chatId: number;
  carrierId: string;
  role: GatewayRole;
}

type ToolHandler<TShape extends ZodRawShape> = (
  input: z.infer<z.ZodObject<TShape>>,
) => ToolResult | Promise<ToolResult>;

function jsonParameters(shape: ZodRawShape): Record<string, unknown> {
  const generated = zodToJsonSchema(z.object(shape), {
    // Model function tools use JSON Schema. OpenAPI 3 emits `exclusiveMinimum: true`, but
    // JSON Schema expects the numeric boundary itself (`0`).
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });
  return typeof generated === 'object' && generated !== null
    ? { ...generated }
    : { type: 'object', properties: {} };
}

/** Define one OpenAI-compatible function tool with runtime Zod validation. */
export function defineTool<TShape extends ZodRawShape>(
  name: string,
  description: string,
  shape: TShape,
  handler: ToolHandler<TShape>,
  riskClass: RiskClass = 'read',
): ToolManifest {
  const schema = z.object(shape);
  return {
    name,
    description,
    parameters: jsonParameters(shape),
    riskClass,
    async execute(input) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        incrementCounter('tool_invalid_args_total');
        return {
          content: [
            {
              type: 'text',
              text: `invalid arguments: ${parsed.error.issues
                .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
                .join('; ')}`,
            },
          ],
          isError: true,
        };
      }
      return handler(parsed.data);
    },
  };
}

export function modelToolDefinitions(
  manifests: readonly ToolManifest[],
): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return manifests.map((manifest) => ({
    type: 'function',
    function: {
      name: manifest.name,
      description: manifest.description,
      parameters: manifest.parameters,
    },
  }));
}

/**
 * The only tool execution path. It rejects unknown tools, validates arguments, re-checks the
 * manifest's per-chat authorization hook, and emits a structured audit row for every attempt.
 */
export async function toolDispatcher(
  manifests: readonly ToolManifest[],
  name: string,
  input: Record<string, unknown>,
  context: ToolAuditContext,
): Promise<string> {
  const startedAt = Date.now();
  const serviceId = serviceForTool(name);
  const isGatewayTool = name.startsWith('octane_') || name.startsWith('telegram_');
  if ((serviceId && !isToolEnabled(name)) || (isGatewayTool && !serviceId)) {
    incrementCounter('tool_disabled_total');
    audit(name, 'unknown', false, startedAt, context);
    return `error: tool "${name}" is disabled`;
  }
  if (!isToolAllowedForRole(name, context.role)) {
    incrementCounter('role_tool_denied_total');
    audit(name, 'unknown', false, startedAt, context);
    return `error: tool "${name}" is not allowed for role "${context.role}"`;
  }
  const manifest = manifests.find((candidate) => candidate.name === name);
  if (!manifest) {
    incrementCounter('tool_unknown_total');
    audit(name, 'unknown', false, startedAt, context);
    return `error: unknown tool "${name}"`;
  }

  const refusal = manifest.authorize?.(input);
  if (refusal) {
    audit(name, manifest.riskClass, false, startedAt, context);
    return `error: ${refusal}`;
  }

  try {
    const result = await manifest.execute(input);
    audit(name, manifest.riskClass, !result.isError, startedAt, context);
    return result.content.map((item) => item.text).join('\n').slice(0, 20_000);
  } catch (error) {
    audit(name, manifest.riskClass, false, startedAt, context);
    return `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000);
  }
}

function audit(
  tool: string,
  riskClass: RiskClass | 'unknown',
  ok: boolean,
  startedAt: number,
  context: ToolAuditContext,
): void {
  console.log(
    JSON.stringify({
      event: 'gateway.tool_call',
      ts: new Date().toISOString(),
      tool,
      riskClass,
      ok,
      durationMs: Date.now() - startedAt,
      chatId: context.chatId,
      carrierId: context.carrierId,
      role: context.role,
    }),
  );
}
