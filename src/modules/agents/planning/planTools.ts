/**
 * Orchestrator-only plan tools bound via createDeepAgent({ tools }). Not in child manifests.
 * Allow mid-turn plan updates / status marks; emit SSE `plan` events for Horizon UI.
 */
import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from '../../../config/env.js';
import { getAgentContext, requireAgentContext } from '../context.js';
import { mergeBlackboard } from '../blackboard.js';
import { agentRegistry } from '../agentRegistry.js';
import { validateExecutionPlan } from './planSchema.js';

const proposeSchema = z.object({
  goal: z.string().min(1).max(2000),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        agent: z.string().min(1).max(40),
        brief: z.string().min(1).max(4000),
        dependsOn: z.array(z.string()).max(8).default([]),
      }),
    )
    .min(1)
    .max(16),
});

const updateSchema = z.object({
  nodeId: z.string().min(1).max(40),
  state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  artifactKey: z.string().max(120).optional(),
  artifactValue: z.unknown().optional(),
});

export function buildOrchestratorPlanTools(): StructuredTool[] {
  if (!env.FF_AGENT_PLAN_DAG) return [];

  const propose = tool(
    async (input: z.infer<typeof proposeSchema>) => {
      const run = requireAgentContext();
      const allowed = agentRegistry.listForContext(run.ctx).map((m) => m.key);
      const validated = validateExecutionPlan(input, allowed);
      if (!validated.ok || !validated.plan) {
        return `Invalid plan: ${validated.errors.join('; ')}`;
      }
      const planId = `plan_${Date.now()}`;
      const nodeStatus = Object.fromEntries(
        validated.plan.nodes.map((n) => [n.id, 'pending' as const]),
      );
      if (env.FF_AGENT_BLACKBOARD && run.conversationId) {
        await mergeBlackboard(
          { ...run.ctx, actingAgent: 'orchestrator' },
          run.conversationId,
          { goal: validated.plan.goal, planId, plan: validated.plan, nodeStatus },
        );
      }
      run.emit?.('plan', {
        planId,
        goal: validated.plan.goal,
        nodes: validated.plan.nodes.map((n) => ({
          id: n.id,
          agent: n.agent,
          state: 'pending',
          dependsOn: n.dependsOn,
        })),
      });
      return `Plan ${planId} accepted with ${validated.plan.nodes.length} nodes. Execute ready nodes with parallel task calls when dependsOn is empty; otherwise wait and pass prior results via blackboard / brief Context.`;
    },
    {
      name: 'plan_propose',
      description:
        'Propose or replace the JSON execution DAG for this multi-step request. Agents must be from your available specialists. Use before delegating multi-step work.',
      schema: zodToJsonSchema(proposeSchema),
    },
  );

  const update = tool(
    async (input: z.infer<typeof updateSchema>) => {
      const run = requireAgentContext();
      if (env.FF_AGENT_BLACKBOARD && run.conversationId) {
        await mergeBlackboard(
          { ...run.ctx, actingAgent: 'orchestrator' },
          run.conversationId,
          {
            nodeStatus: { [input.nodeId]: input.state },
            ...(input.artifactKey
              ? {
                  artifacts: [
                    {
                      key: input.artifactKey,
                      value: input.artifactValue ?? input.state,
                    },
                  ],
                }
              : {}),
          },
        );
      }
      getAgentContext()?.emit?.('plan', {
        nodeId: input.nodeId,
        state: input.state,
      });
      return `Node ${input.nodeId} marked ${input.state}.`;
    },
    {
      name: 'plan_update',
      description:
        'Mark a plan node pending/running/done/failed/skipped and optionally store an artifact on the blackboard.',
      schema: zodToJsonSchema(updateSchema),
    },
  );

  // JSON-schema tool() overload (registry tools use the same pattern) — avoids zod v3/v4 mismatch.
  return [propose, update] as unknown as StructuredTool[];
}
