/**
 * Pre-invoke Plan-and-Execute planner (FF_AGENT_PLAN_DAG). Emits a validated JSON DAG that is
 * seeded into the turn brief as <ExecutionPlan>. The deepagents loop then executes via parallel
 * / sequential `task` calls guided by the plan + blackboard.
 */
import { createId } from '@paralleldrive/cuid2';
import { SystemMessage } from '@langchain/core/messages';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { mergeBlackboard } from '../blackboard.js';
import { resolveOrchestratorModel } from '../models.js';
import {
  formatExecutionPlanXml,
  shouldPlan,
  validateExecutionPlan,
  type ExecutionPlan,
} from './planSchema.js';

export interface PlanSeed {
  planId: string;
  plan: ExecutionPlan;
  xml: string;
}

export async function maybeBuildPlan(opts: {
  message: string;
  ctx: TenantContext;
  conversationId: string;
  allowedAgentKeys: readonly string[];
  isOrchestrator: boolean;
  emit?: (event: string, data: unknown) => void;
}): Promise<PlanSeed | null> {
  if (!shouldPlan(opts.message, opts.isOrchestrator)) return null;

  try {
    const model = resolveOrchestratorModel();
    const agentList = opts.allowedAgentKeys.join(', ');
    const res = await model.invoke([
      new SystemMessage(
        'You are the Octane operations planner. Given a user request, produce a JSON DAG plan. ' +
          'Return ONLY JSON: {"goal": string, "nodes": [{"id": string, "agent": string, "brief": string, "dependsOn": string[]}]}. ' +
          `Use ONLY these agent names: ${agentList}. Max ${env.AGENT_PLAN_MAX_NODES} nodes. ` +
          'Independent work must use empty dependsOn so it can run in parallel. ' +
          'Each brief must be self-contained for a specialist (include IDs/constraints from the user request). ' +
          'Do not invent agents. Prefer 2–5 nodes for multi-step work; one node is ok if only one specialist is needed.',
      ),
      { role: 'user', content: opts.message.slice(0, 4000) },
    ]);
    const raw = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      json = match ? JSON.parse(match[0]) : null;
    }
    const validated = validateExecutionPlan(json, opts.allowedAgentKeys);
    if (!validated.ok || !validated.plan) {
      logger.warn({ errors: validated.errors }, 'planner produced invalid DAG; skipping plan seed');
      return null;
    }

    const planId = createId();
    const nodeStatus = Object.fromEntries(
      validated.plan.nodes.map((n) => [n.id, 'pending' as const]),
    );
    if (env.FF_AGENT_BLACKBOARD) {
      await mergeBlackboard(
        { ...opts.ctx, actingAgent: 'orchestrator' },
        opts.conversationId,
        {
          goal: validated.plan.goal,
          planId,
          plan: validated.plan,
          nodeStatus,
        },
      );
    }

    opts.emit?.('plan', {
      planId,
      goal: validated.plan.goal,
      nodes: validated.plan.nodes.map((n) => ({
        id: n.id,
        agent: n.agent,
        state: 'pending',
        dependsOn: n.dependsOn,
      })),
    });

    return {
      planId,
      plan: validated.plan,
      xml: formatExecutionPlanXml(validated.plan),
    };
  } catch (err) {
    logger.warn({ err }, 'planner failed; continuing without ExecutionPlan');
    return null;
  }
}
