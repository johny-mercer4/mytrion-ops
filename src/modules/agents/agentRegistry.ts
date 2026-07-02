/**
 * AgentRegistry — RBAC-gated lookup over the 10 agent manifests, mirroring ToolRegistry.
 * checkAccess decides whether a caller may select/route-to an agent at all; it runs BEFORE
 * the orchestrator is constructed, so a caller's orchestrator never contains agents outside
 * their departments. (Tool calls inside a selected agent are still re-checked per dispatch —
 * this gate is about agent selection, not tool execution.)
 */
import { normalizeDepartments } from '../../lib/department.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { AccessCheck } from '../tools/registry.js';
import { ALL_AGENT_MANIFESTS } from './manifests/index.js';
import type { AgentKey, AgentManifest } from './types.js';

export class AgentRegistry {
  private readonly byKey = new Map<AgentKey, AgentManifest>();

  constructor(manifests: AgentManifest[]) {
    for (const manifest of manifests) {
      if (this.byKey.has(manifest.key)) {
        throw new Error(`Duplicate agent key in registry: ${manifest.key}`);
      }
      this.byKey.set(manifest.key, manifest);
    }
  }

  get(key: AgentKey): AgentManifest | undefined {
    return this.byKey.get(key);
  }

  all(): AgentManifest[] {
    return [...this.byKey.values()];
  }

  /**
   * Agent-selection RBAC:
   *  1. hard bypass (BYPASS_USERS) → allow;
   *  2. audience must be allowed by the agent;
   *  3. allDepartmentAccess (admin/manager-tier) → allow;
   *  4. otherwise the caller needs an overlapping department; an empty `departments`
   *     grant means the agent is reserved for allDepartmentAccess callers only.
   */
  checkAccess(manifest: AgentManifest, ctx: TenantContext): AccessCheck {
    if (ctx.bypassRbac) return { ok: true };
    if (!manifest.allowedAudiences.includes(ctx.audience)) {
      return {
        ok: false,
        reason: `agent '${manifest.key}' is not available to audience '${ctx.audience}'`,
      };
    }
    if (ctx.allDepartmentAccess) return { ok: true };
    const granted = normalizeDepartments(manifest.departments);
    if (granted.length > 0 && ctx.departments.some((d) => granted.includes(d))) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        granted.length === 0
          ? `agent '${manifest.key}' requires all-department (admin) access`
          : `agent '${manifest.key}' is restricted to departments: ${granted.join(', ')}`,
    };
  }

  /** Agents the caller may select — the orchestrator is built from exactly this set. */
  listForContext(ctx: TenantContext): AgentManifest[] {
    return this.all().filter((manifest) => this.checkAccess(manifest, ctx).ok);
  }
}

export const agentRegistry = new AgentRegistry(ALL_AGENT_MANIFESTS);
