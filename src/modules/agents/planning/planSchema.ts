import { z } from 'zod';
import { env } from '../../../config/env.js';
import { isAgentKey } from '../types.js';

export const planNodeSchema = z.object({
  id: z.string().min(1).max(40),
  agent: z.string().min(1).max(40),
  brief: z.string().min(1).max(4000),
  dependsOn: z.array(z.string().min(1).max(40)).max(8).default([]),
});

export const executionPlanSchema = z.object({
  goal: z.string().min(1).max(2000),
  nodes: z.array(planNodeSchema).min(1).max(16),
});

export type PlanNode = z.infer<typeof planNodeSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export interface PlanValidationResult {
  ok: boolean;
  plan?: ExecutionPlan;
  errors: string[];
}

/** Topological readiness: nodes with all deps done. */
export function readyNodes(
  plan: ExecutionPlan,
  status: Record<string, 'pending' | 'running' | 'done' | 'failed' | 'skipped'>,
): PlanNode[] {
  return plan.nodes.filter((n) => {
    const st = status[n.id] ?? 'pending';
    if (st !== 'pending') return false;
    return n.dependsOn.every((d) => status[d] === 'done');
  });
}

export function hasCycle(plan: ExecutionPlan): boolean {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const node = byId.get(id);
    for (const d of node?.dependsOn ?? []) {
      if (walk(d)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return plan.nodes.some((n) => walk(n.id));
}

export function maxParallelWidth(plan: ExecutionPlan): number {
  // Approximate: largest antichain of nodes with empty dependsOn among unresolved — use level sizes.
  const indeg = new Map(plan.nodes.map((n) => [n.id, n.dependsOn.length]));
  const children = new Map<string, string[]>();
  for (const n of plan.nodes) {
    for (const d of n.dependsOn) {
      const list = children.get(d) ?? [];
      list.push(n.id);
      children.set(d, list);
    }
  }
  let layer = plan.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  let maxW = layer.length;
  const seen = new Set<string>();
  while (layer.length) {
    maxW = Math.max(maxW, layer.length);
    const next: string[] = [];
    for (const id of layer) {
      seen.add(id);
      for (const c of children.get(id) ?? []) {
        indeg.set(c, (indeg.get(c) ?? 1) - 1);
        if ((indeg.get(c) ?? 0) === 0 && !seen.has(c)) next.push(c);
      }
    }
    layer = next;
  }
  return maxW;
}

/**
 * Validate a candidate plan against RBAC-visible agent keys and structural limits.
 */
export function validateExecutionPlan(
  raw: unknown,
  allowedAgentKeys: readonly string[],
): PlanValidationResult {
  const errors: string[] = [];
  const parsed = executionPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  }
  const plan = parsed.data;
  if (plan.nodes.length > env.AGENT_PLAN_MAX_NODES) {
    errors.push(`too many nodes (max ${env.AGENT_PLAN_MAX_NODES})`);
  }
  const ids = new Set<string>();
  const allowed = new Set(allowedAgentKeys);
  for (const n of plan.nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id '${n.id}'`);
    ids.add(n.id);
    if (!isAgentKey(n.agent) || !allowed.has(n.agent)) {
      errors.push(`agent '${n.agent}' is not available to this caller`);
    }
    for (const d of n.dependsOn) {
      if (!plan.nodes.some((x) => x.id === d)) errors.push(`node '${n.id}' depends on unknown '${d}'`);
    }
  }
  if (hasCycle(plan)) errors.push('plan contains a cycle');
  if (maxParallelWidth(plan) > env.AGENT_PLAN_MAX_PARALLEL) {
    errors.push(`parallel width exceeds ${env.AGENT_PLAN_MAX_PARALLEL}`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, plan, errors: [] };
}

/** Heuristic: skip planner for trivial / greeting turns (preserve TTFT). */
export function shouldPlan(message: string, isOrchestrator: boolean): boolean {
  if (!isOrchestrator || !env.FF_AGENT_PLAN_DAG) return false;
  const t = message.trim();
  if (t.length < 12) return false;
  if (/^(hi|hello|hey|thanks|thank you|yo|good (morning|afternoon|evening))\b/i.test(t)) {
    return false;
  }
  // Multi-step / multi-domain cues.
  if (/\b(and|then|also|after|plus|both|compare)\b/i.test(t)) return true;
  if (/\b(balance|invoice|retention|pipeline|ticket|verify|collection|gallons)\b/i.test(t) && t.length > 40) {
    return true;
  }
  return t.length > 120;
}

export function formatExecutionPlanXml(plan: ExecutionPlan): string {
  const nodes = plan.nodes
    .map(
      (n) =>
        `  <Node id="${n.id}" agent="${n.agent}" dependsOn="${n.dependsOn.join(',')}">${n.brief}</Node>`,
    )
    .join('\n');
  return `<ExecutionPlan>\n  <Goal>${plan.goal}</Goal>\n${nodes}\n</ExecutionPlan>`;
}
