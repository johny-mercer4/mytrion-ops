/**
 * Authority narrowing — the security core of the multi-agent system.
 *
 * When the orchestrator hands work to a child agent, the child runs under a context derived
 * from the caller's, and that derivation may only ever NARROW authority:
 *
 *   1. departments := caller ∩ agent's operating departments (admins: the operating list
 *      itself — bounded, explicit, never "everything").
 *   2. allDepartmentAccess is ALWAYS dropped — no child runs with the global bypass.
 *   3. bypassRbac is ALWAYS dropped — BYPASS_USERS never propagates into an agent run.
 *   4. read-only agents additionally have write/destructive tools stripped at binding time
 *      AND re-denied at dispatch (DispatchOptions.readOnly).
 *
 * Tool calls inside the child still go through dispatchTool → ToolRegistry.checkAccess with
 * this narrowed context, so narrowing composes with (never replaces) the per-call RBAC gate.
 */
import { normalizeDepartments } from '../../lib/department.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { AgentManifest } from './types.js';

function intersect(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b);
  return a.filter((v) => set.has(v));
}

/** The context a child agent runs under. Never wider than the caller's own context. */
export function narrowContext(ctx: TenantContext, manifest: AgentManifest): TenantContext {
  const operating = normalizeDepartments(manifest.operatingDepartments ?? manifest.departments);
  const departments = ctx.allDepartmentAccess
    ? operating
    : intersect(normalizeDepartments(ctx.departments), operating);

  const narrowed: TenantContext = {
    ...ctx,
    departments,
    allDepartmentAccess: false,
    actingAgent: manifest.key,
  };
  delete narrowed.bypassRbac;
  return narrowed;
}

/** Effective retrieval scope for a child agent's knowledge searches. */
export interface EffectiveRagScope {
  departments: string[];
  /** True only for allowAllDepartments agents run by allDepartmentAccess callers. */
  allDepartmentAccess: boolean;
}

/**
 * RAG scoping for a child agent. `manifest.ragScope.departments` is a cap:
 *  - regular callers: their own departments, intersected with the cap when one is set;
 *  - allDepartmentAccess callers: the cap itself (or the operating departments when no cap),
 *    unless the agent declares allowAllDepartments — then retrieval stays unfiltered.
 * Global (NULL-tagged) knowledge remains visible in every case via the repo filter.
 */
/**
 * The exact context a child agent's knowledge retrieval runs under: the narrowed context with
 * the RAG scope applied on top. This is what the scoped knowledge_search tool passes to the
 * retriever — the RBAC-leakage suite asserts its SQL can never reference foreign departments.
 */
export function effectiveRetrievalContext(ctx: TenantContext, manifest: AgentManifest): TenantContext {
  const narrowed = narrowContext(ctx, manifest);
  const scope = narrowRagScope(ctx, manifest);
  return { ...narrowed, departments: scope.departments, allDepartmentAccess: scope.allDepartmentAccess };
}

export function narrowRagScope(ctx: TenantContext, manifest: AgentManifest): EffectiveRagScope {
  if (ctx.allDepartmentAccess && manifest.ragScope.allowAllDepartments) {
    return { departments: normalizeDepartments(ctx.departments), allDepartmentAccess: true };
  }
  const cap = normalizeDepartments(manifest.ragScope.departments);
  if (ctx.allDepartmentAccess) {
    const bounded = cap.length > 0
      ? cap
      : normalizeDepartments(manifest.operatingDepartments ?? manifest.departments);
    return { departments: bounded, allDepartmentAccess: false };
  }
  const own = normalizeDepartments(ctx.departments);
  return {
    departments: cap.length > 0 ? intersect(own, cap) : own,
    allDepartmentAccess: false,
  };
}
