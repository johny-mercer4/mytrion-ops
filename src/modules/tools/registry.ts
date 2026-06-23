import { hasAllScopes } from '../auth/permissions.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { RegisteredTool, ToolManifest } from './types.js';

export interface AccessCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Adapt a typed ToolManifest into a type-erased RegisteredTool. `run` validates the
 * raw input with the manifest's schema (so the handler receives its precise type),
 * then validates the handler's output. No `any` and no casts are needed.
 */
export function registerTool<I, O>(manifest: ToolManifest<I, O>): RegisteredTool {
  const tool: RegisteredTool = {
    name: manifest.name,
    description: manifest.description,
    inputSchema: manifest.inputSchema,
    outputSchema: manifest.outputSchema,
    riskClass: manifest.riskClass,
    allowedAudiences: manifest.allowedAudiences,
    requiredScopes: manifest.requiredScopes,
    run: async (rawInput, ctx) => {
      const input = manifest.inputSchema.parse(rawInput);
      const output = await manifest.handler(input, ctx);
      return manifest.outputSchema.parse(output);
    },
  };
  if (manifest.rateLimit) tool.rateLimit = manifest.rateLimit;
  if (manifest.allowedDepartments) tool.allowedDepartments = manifest.allowedDepartments;
  return tool;
}

/**
 * Department RBAC for a tool. No `allowedDepartments` (or empty) = open to all departments.
 * Otherwise the caller needs allDepartmentAccess or at least one overlapping department.
 */
function hasDepartmentAccess(tool: RegisteredTool, ctx: TenantContext): boolean {
  const allowed = tool.allowedDepartments;
  if (!allowed || allowed.length === 0) return true;
  if (ctx.allDepartmentAccess) return true;
  return ctx.departments.some((d) => allowed.includes(d));
}

export class ToolRegistry {
  private readonly byName = new Map<string, RegisteredTool>();

  constructor(tools: RegisteredTool[]) {
    for (const tool of tools) {
      if (this.byName.has(tool.name)) {
        throw new Error(`Duplicate tool name in registry: ${tool.name}`);
      }
      this.byName.set(tool.name, tool);
    }
  }

  /**
   * Add tools after construction (e.g. MCP tools discovered at boot). Idempotent: a name already
   * present is skipped, so re-running boot won't throw on duplicates.
   */
  register(tools: RegisteredTool[]): void {
    for (const tool of tools) {
      if (!this.byName.has(tool.name)) this.byName.set(tool.name, tool);
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.byName.get(name);
  }

  all(): RegisteredTool[] {
    return [...this.byName.values()];
  }

  /** Tools the context may both see and invoke (audience + scopes + write-risk). */
  listForContext(ctx: TenantContext): RegisteredTool[] {
    return this.all().filter((tool) => this.checkAccess(tool, ctx).ok);
  }

  /**
   * The single RBAC gate, evaluated server-side on every dispatch:
   *  1. audience must be allowed by the tool,
   *  2. context must hold ALL required scopes ('*' satisfies any),
   *  3. non-read (write/destructive) tools require the admin role.
   */
  checkAccess(tool: RegisteredTool, ctx: TenantContext): AccessCheck {
    if (!tool.allowedAudiences.includes(ctx.audience)) {
      return { ok: false, reason: `tool '${tool.name}' is not available to audience '${ctx.audience}'` };
    }
    if (!hasAllScopes(ctx.scopes, tool.requiredScopes)) {
      return { ok: false, reason: `missing required scope(s): ${tool.requiredScopes.join(', ')}` };
    }
    if (tool.riskClass !== 'read' && ctx.role !== 'admin') {
      return { ok: false, reason: `${tool.riskClass} tools require the admin role` };
    }
    if (!hasDepartmentAccess(tool, ctx)) {
      return {
        ok: false,
        reason: `tool '${tool.name}' is restricted to departments: ${tool.allowedDepartments?.join(', ')}`,
      };
    }
    return { ok: true };
  }
}
