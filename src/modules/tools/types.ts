import type { z, ZodTypeAny } from 'zod';
import type { Audience, TenantContext } from '../../types/tenantContext.js';

export type RiskClass = 'read' | 'write' | 'destructive';

/** Handlers receive the security context as their second argument. */
export type ToolContext = TenantContext;

/**
 * The contract every tool implements. The dispatcher validates input against
 * `inputSchema`, enforces RBAC (audience + scopes + write-risk), runs `handler`,
 * then validates the result against `outputSchema`.
 */
export interface ToolManifest<TInput, TOutput> {
  /** Stable id, e.g. 'zoho_crm.search_accounts'. Also used as the OpenAI tool name. */
  name: string;
  /** Used by the LLM to decide when to call the tool. */
  description: string;
  // Output (parsed) type is pinned to TInput/TOutput; the *input* side is left open
  // so schemas using .default()/.transform() (input type differs from output) fit.
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  outputSchema: z.ZodType<TOutput, z.ZodTypeDef, unknown>;
  riskClass: RiskClass;
  allowedAudiences: Audience[];
  requiredScopes: string[];
  /**
   * Departments allowed to use this tool (RBAC). Omit/empty = available to all departments.
   * When set, the caller must have allDepartmentAccess or an overlapping department.
   */
  allowedDepartments?: string[];
  rateLimit?: { perMinute: number };
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

/**
 * Type-erased tool used by the registry/dispatcher. `run` closes over the typed
 * manifest, validating input before the handler and output after — so callers
 * never see `any` and the handler still receives its precise input type.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  riskClass: RiskClass;
  allowedAudiences: Audience[];
  requiredScopes: string[];
  allowedDepartments?: string[];
  rateLimit?: { perMinute: number };
  run: (rawInput: unknown, ctx: ToolContext) => Promise<unknown>;
}
