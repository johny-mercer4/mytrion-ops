/**
 * Bridge Zoho MCP tools into our tool registry. At boot (when FF_ZOHO_MCP_ENABLED) we discover the
 * connected server's tools and wrap each as a RegisteredTool so it flows through the SAME
 * toolDispatcher path as native tools — RBAC + audit + risk-gating all apply. MCP tools are
 * Zoho-defined, so their parameters come as JSON Schema (kept verbatim for OpenAI) and we classify
 * read vs write by the tool's verb, defaulting unknown verbs to write (read-only posture).
 *
 * WRITE EXPOSURE — read carefully: write tools are only registered when FF_ZOHO_MCP_WRITES is on.
 * Note that the riskClass 'write' + admin-role RBAC check is NOT a meaningful second factor here:
 * the sole inbound identity (the static API_KEY) is already admin with wildcard scope, so once the
 * flag is on, any API_KEY caller can invoke writes. The real controls are therefore (1) this flag
 * (off by default) and (2) the scopes you grant the Zoho MCP connection itself — create a READ-ONLY
 * connection in the Zoho console if you don't want writes reachable at all (defense in depth).
 */
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { callMcpTool, listMcpTools, type McpToolDef } from '../../integrations/zohoMcp.js';
import type { RegisteredTool, RiskClass } from './types.js';

/**
 * Classify an MCP tool by its verb. The verb may lead the name (bare `getRecords`) or follow a
 * service prefix (`ZohoCRM_getRecords`), so we match at the start OR after an underscore. Unknown
 * verbs default to write so a misclassification can never silently expose a mutation as a read.
 */
export function classifyMcpRisk(name: string): RiskClass {
  const n = name.toLowerCase();
  if (/(^|_)(get|search|list|read|describe|count|fetch)/.test(n) || n.includes('coql')) return 'read';
  if (/(^|_)(create|update|upsert|delete|insert|convert|add|remove|send|merge|execute)/.test(n)) {
    return 'write';
  }
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

function buildMcpTool(def: McpToolDef, riskClass: RiskClass): RegisteredTool {
  return {
    name: `zoho_mcp.${def.name}`,
    description: `[Zoho CRM · MCP] ${def.description}`.slice(0, 1024),
    // The MCP server validates arguments; we keep our schema permissive and pass them through.
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    riskClass,
    allowedAudiences: ['internal', 'customer', 'partner'],
    requiredScopes: riskClass === 'read' ? ['zoho_crm:read'] : ['zoho_crm:write'],
    rateLimit: { perMinute: 30 },
    rawParameters: paramsForOpenAi(def.inputSchema),
    run: (rawInput, ctx) => callMcpTool(def.name, isRecord(rawInput) ? rawInput : {}, ctx),
  };
}

/**
 * Discover + wrap the Zoho MCP tools to register at boot. Returns [] when disabled/unconfigured.
 * Write tools are only included when FF_ZOHO_MCP_WRITES is also on (read-only by default).
 */
export async function loadMcpTools(): Promise<RegisteredTool[]> {
  if (!env.FF_ZOHO_MCP_ENABLED || !env.ZOHO_MCP_URL) return [];
  const defs = await listMcpTools();
  const tools: RegisteredTool[] = [];
  let skippedWrites = 0;
  for (const def of defs) {
    const riskClass = classifyMcpRisk(def.name);
    if (riskClass !== 'read' && !env.FF_ZOHO_MCP_WRITES) {
      skippedWrites += 1;
      continue;
    }
    tools.push(buildMcpTool(def, riskClass));
  }
  logger.info(
    { discovered: defs.length, registered: tools.length, skippedWrites },
    'zoho mcp: tools loaded',
  );
  return tools;
}
