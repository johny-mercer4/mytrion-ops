/**
 * Department agents — the per-department "personalities" used by the /v1/chat pipeline.
 *
 * As of the multi-agent core, this file is a DERIVED SHIM: the single source of truth is the
 * typed AgentManifest registry (./manifests). Everything here — the persona per department,
 * which departments may use which tool (applyDepartmentPolicy), and the admin-only sentinel —
 * is re-computed from those manifests so the hand-rolled chat loop and the orchestrator can
 * never disagree about policy.
 *
 * Derivation rules:
 *   1. DEPARTMENT_AGENTS maps each department tag to its primary agent: an agent whose key
 *      equals the tag claims it first (sales → sales); remaining tags go to the first agent
 *      granting them (management/c-level → manager).
 *   2. departmentsForTool(name) = union of `departments` over manifests listing the tool;
 *      universal tools stay open; tools no manifest lists fall back to the admin-only sentinel.
 *
 * RAG stays department-scoped at the knowledge layer (department_access); admin/unlimited
 * callers (resolveAllDepartmentAccess) bypass all of this, exactly as before.
 */
import type { RegisteredTool } from '../tools/types.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { normalizeDepartments } from '../../lib/department.js';
import { ALL_AGENT_MANIFESTS } from './manifests/index.js';

export interface DepartmentAgent {
  /** Normalized department key — matches department_access tags + ctx.departments. */
  key: string;
  label: string;
  /** Department-specific tools (the universal tools below are added to every agent). */
  tools: string[];
  persona: string;
}

/** Tools open to EVERY caller (RAG search is internally department-scoped in the retriever). */
export const UNIVERSAL_TOOLS = ['knowledge.search'] as const;

/**
 * Sentinel for "admin-only" tools: a department value no real caller ever holds, so only
 * allDepartmentAccess (admin) passes hasDepartmentAccess. Used for the broad Zoho-MCP CRM tools
 * and anything no agent manifest claims.
 */
export const ADMIN_ONLY_DEPARTMENTS = ['__admin_only__'] as const;

function deriveDepartmentAgents(): Record<string, DepartmentAgent> {
  const record: Record<string, DepartmentAgent> = {};
  const toEntry = (m: (typeof ALL_AGENT_MANIFESTS)[number]): DepartmentAgent => ({
    key: m.key,
    label: m.label,
    tools: [...m.tools],
    persona: m.persona,
  });
  // Pass 1: agents claim the department tag matching their own key (sales → 'sales').
  for (const m of ALL_AGENT_MANIFESTS) {
    const depts = normalizeDepartments(m.departments);
    if (depts.includes(m.key)) record[m.key] = toEntry(m);
  }
  // Pass 2: remaining granted tags go to the first agent granting them (management → manager).
  for (const m of ALL_AGENT_MANIFESTS) {
    for (const dept of normalizeDepartments(m.departments)) {
      if (!record[dept]) record[dept] = toEntry(m);
    }
  }
  return record;
}

export const DEPARTMENT_AGENTS: Record<string, DepartmentAgent> = deriveDepartmentAgents();

const ADMIN_PERSONA =
  'You are Octane’s internal admin assistant for Developers, Managers, and Administrators. You ' +
  'have unrestricted access to every department’s knowledge and all tools (including the Zoho ' +
  'MCP CRM tools and employee lookups). Still default to read-only unless a write is explicitly enabled.';

const DEFAULT_PERSONA =
  'You are Octane Assistant. This user has no specific department, so you can only use the shared ' +
  '(global) knowledge base. If a request needs department-specific data or tools, explain that they ' +
  'need the appropriate department access.';

const STAY_IN_LANE_COMBINED =
  'Only use these departments’ knowledge and the tools available to you. If asked about another ' +
  'team’s data or for something outside your scope, say you don’t have access rather than guessing.';

/** The persona block for a turn: admin → all-access; one/more known departments → their persona(s). */
export function resolveAgentPersona(ctx: TenantContext): string {
  if (ctx.allDepartmentAccess) return ADMIN_PERSONA;
  const matched = ctx.departments
    .map((d) => DEPARTMENT_AGENTS[d])
    .filter((a): a is DepartmentAgent => a !== undefined);
  const unique = [...new Map(matched.map((a) => [a.key, a])).values()];
  const [first] = unique;
  if (!first) return DEFAULT_PERSONA;
  if (unique.length === 1) return first.persona;
  // Multiple departments: serve all of them, list them so the model knows its combined scope.
  return (
    `You are Octane’s assistant for these departments: ${unique.map((a) => a.label).join(', ')}. ` +
    `Use the knowledge and tools available across those departments. ${STAY_IN_LANE_COMBINED}`
  );
}

/**
 * The departments allowed to use a given tool, derived from the agent manifests:
 *   - universal tools  → [] (open to everyone; RAG is dept-scoped internally)
 *   - manifest tools   → union of the granting departments of every agent listing it
 *   - anything else    → admin-only sentinel (only allDepartmentAccess passes)
 */
/** Manifest entry matches a concrete tool name, including `prefix.*` wildcards. */
function manifestListsTool(manifestTools: readonly string[], toolName: string): boolean {
  return manifestTools.some(
    (t) => t === toolName || (t.endsWith('.*') && toolName.startsWith(t.slice(0, -1))),
  );
}

export function departmentsForTool(toolName: string): string[] {
  if ((UNIVERSAL_TOOLS as readonly string[]).includes(toolName)) return [];
  const depts = new Set<string>();
  for (const m of ALL_AGENT_MANIFESTS) {
    if (!manifestListsTool(m.tools, toolName)) continue;
    for (const dept of normalizeDepartments(m.departments)) depts.add(dept);
  }
  return depts.size > 0 ? [...depts] : [...ADMIN_ONLY_DEPARTMENTS];
}

/** Stamp each tool's `allowedDepartments` from the manifests (mutates in place). */
export function applyDepartmentPolicy(tools: RegisteredTool[]): void {
  for (const tool of tools) {
    tool.allowedDepartments = departmentsForTool(tool.name);
  }
}
