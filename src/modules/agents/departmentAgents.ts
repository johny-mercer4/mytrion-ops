/**
 * Department agents — the per-department "personalities" that distribute Octane's AI features
 * across operational teams (Sales, Billing, Customer Service, Verification, Collection, Retention).
 *
 * An agent bundles, for one department:
 *   - persona  : the system-prompt block that frames how the assistant behaves for that team
 *   - tools    : the department-specific tools that team may call (beyond the universal ones)
 *
 * This registry is the SINGLE SOURCE OF TRUTH for both concerns:
 *   1. Tool gating — each tool's `allowedDepartments` is derived here (applyDepartmentPolicy) and
 *      enforced by toolDispatcher/checkAccess, so the LLM only sees + can only call its team's tools.
 *   2. Persona — buildSystemPrompt asks resolveAgentPersona(ctx) for the right block.
 *
 * RAG is already department-scoped at the knowledge layer (department_access), so an agent's
 * knowledge is automatically limited to its department + global docs — nothing to wire here.
 *
 * Admin/unlimited callers (Developers, Managers, Admins — see resolveAllDepartmentAccess) bypass
 * all of this: every department's RAG + every tool, with the admin persona.
 */
import type { RegisteredTool } from '../tools/types.js';
import type { TenantContext } from '../../types/tenantContext.js';

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
 * and HR/people lookups.
 */
export const ADMIN_ONLY_DEPARTMENTS = ['__admin_only__'] as const;

const STAY_IN_LANE =
  'Only use this department’s knowledge and the tools available to you. If asked about another ' +
  'team’s data or for something outside your scope, say you don’t have access rather than guessing.';

export const DEPARTMENT_AGENTS: Record<string, DepartmentAgent> = {
  sales: {
    key: 'sales',
    label: 'Sales',
    tools: ['agent.sales_snapshot', 'agent.activity', 'zoho_crm.query'],
    persona:
      'You are Octane’s Sales assistant, supporting the Sales team with leads, deals, fuel-card ' +
      `demos, pipeline activity, and sales performance. ${STAY_IN_LANE}`,
  },
  billing: {
    key: 'billing',
    label: 'Billing',
    tools: ['agent.debtors', 'zoho_crm.query'],
    persona:
      'You are Octane’s Billing assistant, supporting the Billing team with invoices, refunds, ' +
      `outstanding balances, debtors, and billing policy. ${STAY_IN_LANE}`,
  },
  'customer-service': {
    key: 'customer-service',
    label: 'Customer Service',
    tools: ['zoho_desk.search_tickets', 'zoho_crm.query'],
    persona:
      'You are Octane’s Customer Service assistant, supporting the support team with tickets, ' +
      `customer inquiries, and contact lookups. ${STAY_IN_LANE}`,
  },
  verification: {
    key: 'verification',
    label: 'Verification',
    tools: ['zoho_crm.query'],
    persona:
      'You are Octane’s Verification assistant, supporting the team that verifies applications, ' +
      `identity, and documents before approval. ${STAY_IN_LANE}`,
  },
  collection: {
    key: 'collection',
    label: 'Collection',
    tools: ['agent.debtors', 'zoho_crm.query'],
    persona:
      'You are Octane’s Collections assistant, supporting the team that follows up on overdue ' +
      `accounts and outstanding balances. ${STAY_IN_LANE}`,
  },
  retention: {
    key: 'retention',
    label: 'Retention',
    tools: ['zoho_crm.query'],
    persona:
      'You are Octane’s Retention assistant, supporting the team that handles renewals, churn ' +
      `risk, and win-back offers. ${STAY_IN_LANE}`,
  },
};

const ADMIN_PERSONA =
  'You are Octane’s internal admin assistant for Developers, Managers, and Administrators. You ' +
  'have unrestricted access to every department’s knowledge and all tools (including the Zoho ' +
  'MCP CRM tools and employee lookups). Still default to read-only unless a write is explicitly enabled.';

const DEFAULT_PERSONA =
  'You are Octane Assistant. This user has no specific department, so you can only use the shared ' +
  '(global) knowledge base. If a request needs department-specific data or tools, explain that they ' +
  'need the appropriate department access.';

/** The persona block for a turn: admin → all-access; one/more known departments → their persona(s). */
export function resolveAgentPersona(ctx: TenantContext): string {
  if (ctx.allDepartmentAccess) return ADMIN_PERSONA;
  const matched = ctx.departments
    .map((d) => DEPARTMENT_AGENTS[d])
    .filter((a): a is DepartmentAgent => a !== undefined);
  const [first] = matched;
  if (!first) return DEFAULT_PERSONA;
  if (matched.length === 1) return first.persona;
  // Multiple departments: serve all of them, list them so the model knows its combined scope.
  return (
    `You are Octane’s assistant for these departments: ${matched.map((a) => a.label).join(', ')}. ` +
    `Use the knowledge and tools available across those departments. ${STAY_IN_LANE}`
  );
}

/**
 * The departments allowed to use a given tool, derived from the agent registry:
 *   - universal tools  → [] (open to everyone; RAG is dept-scoped internally)
 *   - department tools → the department keys whose agent lists it
 *   - anything else    → admin-only sentinel (only allDepartmentAccess passes)
 */
export function departmentsForTool(toolName: string): string[] {
  if ((UNIVERSAL_TOOLS as readonly string[]).includes(toolName)) return [];
  const depts = Object.values(DEPARTMENT_AGENTS)
    .filter((a) => a.tools.includes(toolName))
    .map((a) => a.key);
  return depts.length > 0 ? depts : [...ADMIN_ONLY_DEPARTMENTS];
}

/** Stamp each tool's `allowedDepartments` from the registry (mutates in place). */
export function applyDepartmentPolicy(tools: RegisteredTool[]): void {
  for (const tool of tools) {
    tool.allowedDepartments = departmentsForTool(tool.name);
  }
}
