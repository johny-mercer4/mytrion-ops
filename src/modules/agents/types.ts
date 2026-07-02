/**
 * AgentManifest — the typed, declarative definition of one child agent in the multi-agent core
 * (analogous to ToolManifest for tools). Everything Octane-specific about an agent lives here:
 * persona, RBAC (which callers may use it), tool allowlist, RAG scope, and escalation routing.
 * The orchestrator compiles manifests into runtime subagents per request, AFTER filtering them
 * through AgentRegistry.checkAccess — so a caller's orchestrator never even contains agents
 * outside their department scope.
 */
import type { Audience } from '../../types/tenantContext.js';

export const AGENT_KEYS = [
  'customer-service',
  'billing',
  'verification',
  'retention',
  'sales',
  'marketing',
  'finance',
  'analyst',
  'manager',
  'collection',
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === 'string' && (AGENT_KEYS as readonly string[]).includes(value);
}

/**
 * How the agent's knowledge retrieval is scoped. `departments` is a CAP, never a grant:
 * retrieval departments are always intersected with (or, for allDepartmentAccess callers,
 * bounded by) this list. Empty = no extra cap (the narrowed context's departments apply).
 */
export interface AgentRagScope {
  departments: string[];
  /**
   * When true AND the caller has allDepartmentAccess, the agent retrieves unfiltered
   * (analyst/manager). For everyone else this flag has no effect — RAG can never widen
   * beyond the caller's own access.
   */
  allowAllDepartments: boolean;
}

export interface AgentManifest {
  key: AgentKey;
  label: string;
  /**
   * ≤2 sentences. This is the ONLY text about the agent that enters the orchestrator's
   * context (used for routing), so it must say precisely what the agent owns.
   */
  description: string;
  /** Byte-stable persona/system-prompt block (TS const — prompts live in code, not markdown). */
  persona: string;
  /**
   * department_access tags that grant a caller access to this agent (RBAC).
   * Empty = only allDepartmentAccess (admin/manager-tier) callers may select it.
   */
  departments: string[];
  /**
   * Departments the agent OPERATES across once selected (tool gating inside the run).
   * Defaults to `departments`. Cross-department read agents (analyst, manager) set this
   * wider than their access grant; narrowContext still intersects it with the caller's
   * own departments unless the caller has allDepartmentAccess.
   */
  operatingDepartments?: string[];
  allowedAudiences: Audience[];
  /** Registry tool-name allowlist. Bound tools = RBAC listForContext(narrowed ctx) ∩ this list. */
  tools: string[];
  /** Composio toolkit slugs this agent may use (intersected with the enabled toolkits + gates). */
  composioToolkits: string[];
  ragScope: AgentRagScope;
  /**
   * Read-only agents (analyst, manager) never execute non-read tools: write/destructive tools
   * are stripped from the bound tool list AND the dispatcher re-denies them (defense in depth).
   */
  readOnly: boolean;
  /** Grants access to the general web-search tool at compile time (e.g. marketing). */
  webSearch?: boolean;
  /**
   * Grants the Composio browser/scraping toolkit at compile time (FF_BROWSER_ENABLED +
   * admin gate + BROWSER_ALLOWED_DOMAINS still apply — this only opts the agent in).
   */
  browser?: boolean;
  /** Chat model id override; unset → AGENT_CHILD_MODEL → default chat model. */
  model?: string;
  /** Child agent loop cap (LangGraph recursionLimit). Unset → AGENT_MAX_CHILD_ITERATIONS. */
  maxIterations?: number;
  /**
   * Agents this one may recommend escalating to (advisory routing metadata). Children never
   * call each other directly — they return `escalate` in their structured result and the
   * orchestrator re-delegates, only ever among the caller's RBAC-filtered agents.
   */
  delegatesTo: AgentKey[];
}
