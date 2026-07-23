/**
 * Helpers for Plan-and-Execute wave execution. The deepagents loop still issues `task` calls;
 * these helpers decide which nodes are ready and when to replan.
 */
import { env } from '../../../config/env.js';
import { readyNodes, type ExecutionPlan, type PlanNode } from './planSchema.js';

export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export function nextWave(
  plan: ExecutionPlan,
  status: Record<string, NodeStatus>,
): PlanNode[] {
  const ready = readyNodes(plan, status);
  return ready.slice(0, env.AGENT_PLAN_MAX_PARALLEL);
}

export function planComplete(plan: ExecutionPlan, status: Record<string, NodeStatus>): boolean {
  return plan.nodes.every((n) => {
    const st = status[n.id] ?? 'pending';
    return st === 'done' || st === 'skipped' || st === 'failed';
  });
}

export function shouldReplan(
  plan: ExecutionPlan,
  status: Record<string, NodeStatus>,
  replanCount: number,
): boolean {
  if (replanCount >= env.AGENT_PLAN_MAX_REPLANS) return false;
  if (planComplete(plan, status)) return false;
  const ready = readyNodes(plan, status);
  if (ready.length > 0) return false;
  // Blocked: remaining pending nodes wait on failed/missing deps.
  return plan.nodes.some((n) => (status[n.id] ?? 'pending') === 'pending');
}

export function orchestrationHint(plan: ExecutionPlan): string {
  const independent = plan.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id);
  return (
    `Execute the <ExecutionPlan> with write_todos + task. ` +
    `Ready now (parallel OK): ${independent.join(', ') || 'none'}. ` +
    `After each node completes, call plan_update and blackboard.write with the durable result, ` +
    `then run the next wave. Max ${env.AGENT_PLAN_MAX_REPLANS} replans via plan_propose if blocked.`
  );
}
