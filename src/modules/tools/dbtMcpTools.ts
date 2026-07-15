/**
 * Bridge the hosted dbt MCP (warehouse + query-memory RAG) into our tool registry — same pattern
 * as mcpTools.ts for Zoho. At boot (FF_DBT_MCP_ENABLED) we discover tools and wrap each as a
 * RegisteredTool so OpenAI/LangChain function-calling goes through toolDispatcher (RBAC + audit).
 *
 * Agentic RAG is **tool-driven**, not prompt-stuffed:
 *   1. Model calls `dbt_mcp.recall_similar_queries` with the user's question (MCP pgvector recall)
 *   2. Adapts proven SQL and calls `dbt_mcp.query` live
 * Worker identity (Zoho email / role / userId) stays on TenantContext and is forwarded as
 * `X-User-Email` on tools/call — never injected into the system prompt.
 *
 * WRITE EXPOSURE: `run` / `test` (and any unknown verb) only register when FF_DBT_MCP_WRITES is on.
 * Department policy stamps unlisted tools admin-only (same as Zoho MCP).
 */
import { z } from 'zod';
import { env } from '../../config/env.js';
import { WILDCARD_SCOPE } from '../../config/constants.js';
import { logger } from '../../lib/logger.js';
import {
  callDbtTool,
  listDbtTools,
  type DbtMcpCallOptions,
  type McpToolDef,
} from '../../integrations/dbtMcp.js';
import type { RegisteredTool, RiskClass, ToolContext } from './types.js';

/**
 * Map a request's security context to the identity we forward to the dbt MCP. The raw Zoho user id
 * (`zoho:<id>` → `<id>`) is the warehouse row-scoping key; role + admin flag ride along for audit
 * and any server-side enforcement. This is CONTEXT (headers), never injected into the prompt.
 */
export function dbtIdentityFromContext(ctx: ToolContext): DbtMcpCallOptions {
  const zohoId = /^zoho:(.+)$/.exec(ctx.userId)?.[1];
  // allDepartmentAccess is stripped by authority.narrowContext inside agent runs; the wildcard scope
  // survives narrowing, so it's the reliable admin signal for the X-User-Admin header + audit.
  const isAdmin = ctx.allDepartmentAccess === true || ctx.scopes.includes(WILDCARD_SCOPE);
  const identity: DbtMcpCallOptions = { isAdmin };
  if (ctx.email) identity.userEmail = ctx.email;
  if (zohoId) identity.userId = zohoId;
  if (ctx.userName) identity.userName = ctx.userName;
  // Prefer the caller's Zoho role string for readability; fall back to the internal role.
  identity.role = ctx.callerRole ?? ctx.role;
  return identity;
}

/** Read tools Claude/OpenAI use for warehouse Q&A; everything else defaults to write. */
const DBT_READ_TOOLS = new Set(['recall_similar_queries', 'query']);

/**
 * Classify dbt MCP tools. Verb heuristics from Zoho MCP do not match these names (`query`
 * would falsely become write), so we allowlist the agentic-read pair and treat the rest as write.
 */
export function classifyDbtMcpRisk(name: string): RiskClass {
  const n = name.toLowerCase();
  if (DBT_READ_TOOLS.has(n)) return 'read';
  if (n === 'run' || n === 'test') return 'write';
  // Unknown → write (fail closed).
  return 'write';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Shallow-clean a JSON Schema for OpenAI: drop the `$schema` meta key (kept otherwise verbatim). */
function paramsForOpenAi(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, ...rest } = schema as { $schema?: unknown } & Record<string, unknown>;
  return Object.keys(rest).length > 0 ? rest : { type: 'object', properties: {} };
}

function buildDbtTool(def: McpToolDef, riskClass: RiskClass): RegisteredTool {
  return {
    name: `dbt_mcp.${def.name}`,
    description: `[Warehouse · MCP] ${def.description}`.slice(0, 1024),
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    riskClass,
    allowedAudiences: ['internal'],
    requiredScopes: [],
    rateLimit: { perMinute: 20 },
    rawParameters: paramsForOpenAi(def.inputSchema),
    run: (rawInput, ctx: ToolContext) =>
      callDbtTool(def.name, isRecord(rawInput) ? rawInput : {}, dbtIdentityFromContext(ctx)),
  };
}

/**
 * Discover + wrap dbt MCP tools to register at boot. Returns [] when disabled/unconfigured.
 * Write tools only when FF_DBT_MCP_WRITES is also on (read-only by default).
 */
export async function loadDbtMcpTools(): Promise<RegisteredTool[]> {
  if (!env.FF_DBT_MCP_ENABLED || !env.DBT_MCP_URL) return [];
  const defs = await listDbtTools();
  const tools: RegisteredTool[] = [];
  let skippedWrites = 0;
  for (const def of defs) {
    const riskClass = classifyDbtMcpRisk(def.name);
    if (riskClass !== 'read' && !env.FF_DBT_MCP_WRITES) {
      skippedWrites += 1;
      continue;
    }
    tools.push(buildDbtTool(def, riskClass));
  }
  logger.info(
    { discovered: defs.length, registered: tools.length, skippedWrites },
    'dbt mcp: tools loaded',
  );
  return tools;
}
