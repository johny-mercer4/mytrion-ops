/**
 * Hard DAG wave executor (FF_AGENT_HARD_DAG): deterministically dispatch ready plan nodes to
 * specialist subagents, write results to the blackboard, and replan when blocked.
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createDeepAgent } from 'deepagents';
import { env } from '../../../config/env.js';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { agentRegistry } from '../agentRegistry.js';
import { mergeBlackboard } from '../blackboard.js';
import { narrowContext } from '../authority.js';
import { resolveAgentModel } from '../models.js';
import { childSystemPrompt } from '../prompts.js';
import { agentResultSchema, type AgentResult } from '../resultSchema.js';
import { buildAgentTools } from '../tools/agentTools.js';
import { buildScopedRagTool } from '../tools/scopedRag.js';
import { webSearchTool } from '../tools/webSearch.js';
import { isAgentKey, type AgentManifest } from '../types.js';
import {
  nextWave,
  planComplete,
  shouldReplan,
  type NodeStatus,
} from './planExecutor.js';
import {
  formatExecutionPlanXml,
  validateExecutionPlan,
  type ExecutionPlan,
} from './planSchema.js';

export interface WaveNodeResult {
  nodeId: string;
  agent: string;
  status: NodeStatus;
  answer: string;
  confidence?: AgentResult['confidence'];
  escalate?: AgentResult['escalate'];
}

export interface HardDagResult {
  plan: ExecutionPlan;
  planId: string;
  nodeStatus: Record<string, NodeStatus>;
  results: WaveNodeResult[];
  replanCount: number;
  /** Compact XML for the orchestrator synthesis brief. */
  waveResultsXml: string;
}

async function childToolsFor(manifest: AgentManifest, callerCtx: TenantContext) {
  const narrowed = narrowContext(callerCtx, manifest);
  const tools = [buildScopedRagTool(manifest, callerCtx), ...buildAgentTools(manifest, narrowed)];
  if (manifest.webSearch) tools.push(webSearchTool);
  return tools;
}

/** Run one specialist once with structured AgentResult (isolated from the parent graph). */
export async function runSubAgentTask(opts: {
  manifest: AgentManifest;
  callerCtx: TenantContext;
  brief: string;
  signal?: AbortSignal;
}): Promise<AgentResult> {
  const agent = createDeepAgent({
    model: resolveAgentModel(opts.manifest),
    systemPrompt: childSystemPrompt(opts.manifest),
    tools: await childToolsFor(opts.manifest, opts.callerCtx),
    // Same schema as SubAgent responseFormat; deepagents CreateDeepAgentParams typing is stricter.
    responseFormat: agentResultSchema as never,
    middleware: [],
  });
  const envBlock = `<Task>\n${opts.brief}\n</Task>\nRespond with the structured AgentResult only.`;
  const out = await agent.invoke(
    { messages: [new HumanMessage(envBlock)] },
    {
      recursionLimit: (opts.manifest.maxIterations ?? env.AGENT_MAX_CHILD_ITERATIONS) * 5 + 10,
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  );

  const structured = (out as { structuredResponse?: unknown }).structuredResponse;
  if (structured) {
    const parsed = agentResultSchema.safeParse(structured);
    if (parsed.success) return parsed.data;
  }
  // Fallback: last AI message text.
  const messages = (out as { messages?: Array<{ content?: unknown }> }).messages ?? [];
  const last = messages.at(-1);
  const text =
    typeof last?.content === 'string'
      ? last.content
      : typeof last?.content === 'object'
        ? JSON.stringify(last.content)
        : 'Specialist produced no structured answer.';
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = agentResultSchema.safeParse(JSON.parse(match[0]));
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* ignore */
  }
  return {
    answer: text.slice(0, 8000),
    citations: [],
    toolsUsed: [],
    confidence: 'low',
    escalate: null,
  };
}

function formatWaveResultsXml(results: WaveNodeResult[]): string {
  const body = results
    .map(
      (r) =>
        `  <NodeResult id="${r.nodeId}" agent="${r.agent}" status="${r.status}" confidence="${r.confidence ?? ''}">\n` +
        `    ${r.answer.slice(0, 2000)}\n` +
        (r.escalate ? `    <Escalate to="${r.escalate.toAgent}">${r.escalate.reason}</Escalate>\n` : '') +
        `  </NodeResult>`,
    )
    .join('\n');
  return `<WaveResults>\n${body}\n</WaveResults>`;
}

async function replanRemaining(opts: {
  message: string;
  plan: ExecutionPlan;
  status: Record<string, NodeStatus>;
  allowedAgentKeys: readonly string[];
  results: WaveNodeResult[];
}): Promise<ExecutionPlan | null> {
  const { resolveOrchestratorModel } = await import('../models.js');
  const model = resolveOrchestratorModel();
  const done = opts.results
    .filter((r) => r.status === 'done')
    .map((r) => `${r.nodeId}(${r.agent}): ${r.answer.slice(0, 400)}`)
    .join('\n');
  const failed = Object.entries(opts.status)
    .filter(([, st]) => st === 'failed')
    .map(([id]) => id)
    .join(', ');
  const res = await model.invoke([
    new SystemMessage(
      'You are replanning a blocked DAG. Return ONLY JSON: ' +
        '{"goal": string, "nodes": [{"id": string, "agent": string, "brief": string, "dependsOn": string[]}]}. ' +
        `Agents allowed: ${opts.allowedAgentKeys.join(', ')}. ` +
        'Keep completed work as already-done context in briefs; only emit remaining nodes.',
    ),
    {
      role: 'user',
      content:
        `User request: ${opts.message.slice(0, 2000)}\n` +
        `Failed nodes: ${failed || 'none'}\nCompleted:\n${done || 'none'}\n` +
        `Prior plan goal: ${opts.plan.goal}`,
    },
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
  return validated.ok && validated.plan ? validated.plan : null;
}

/**
 * Execute a validated plan wave-by-wave. Returns synthesis payload for the orchestrator.
 */
export async function runHardDagWaves(opts: {
  plan: ExecutionPlan;
  planId: string;
  message: string;
  ctx: TenantContext;
  conversationId: string;
  allowedAgentKeys: readonly string[];
  signal?: AbortSignal;
  emit?: (event: string, data: unknown) => void;
}): Promise<HardDagResult> {
  let plan = opts.plan;
  let replanCount = 0;
  const nodeStatus: Record<string, NodeStatus> = Object.fromEntries(
    plan.nodes.map((n) => [n.id, 'pending' as const]),
  );
  const results: WaveNodeResult[] = [];

  const persistStatus = async () => {
    if (!env.FF_AGENT_BLACKBOARD) return;
    await mergeBlackboard(
      { ...opts.ctx, actingAgent: 'orchestrator' },
      opts.conversationId,
      { planId: opts.planId, plan, nodeStatus },
    );
  };

  while (!planComplete(plan, nodeStatus)) {
    if (opts.signal?.aborted) break;
    const wave = nextWave(plan, nodeStatus);
    if (wave.length === 0) {
      if (!shouldReplan(plan, nodeStatus, replanCount)) break;
      const next = await replanRemaining({
        message: opts.message,
        plan,
        status: nodeStatus,
        allowedAgentKeys: opts.allowedAgentKeys,
        results,
      });
      replanCount += 1;
      if (!next) break;
      plan = next;
      for (const n of plan.nodes) {
        if (!(n.id in nodeStatus)) nodeStatus[n.id] = 'pending';
      }
      opts.emit?.('plan', {
        planId: opts.planId,
        replan: true,
        replanCount,
        goal: plan.goal,
        nodes: plan.nodes.map((n) => ({
          id: n.id,
          agent: n.agent,
          state: nodeStatus[n.id] ?? 'pending',
          dependsOn: n.dependsOn,
        })),
      });
      await persistStatus();
      continue;
    }

    await Promise.all(
      wave.map(async (node) => {
        nodeStatus[node.id] = 'running';
        opts.emit?.('plan', { nodeId: node.id, agent: node.agent, state: 'running' });
        opts.emit?.('agent', { key: node.agent, state: 'start', label: node.agent });

        if (!isAgentKey(node.agent) || !opts.allowedAgentKeys.includes(node.agent)) {
          nodeStatus[node.id] = 'failed';
          results.push({
            nodeId: node.id,
            agent: node.agent,
            status: 'failed',
            answer: `Agent '${node.agent}' is not available to this caller.`,
          });
          opts.emit?.('plan', { nodeId: node.id, agent: node.agent, state: 'failed' });
          return;
        }
        const manifest = agentRegistry.get(node.agent);
        if (!manifest) {
          nodeStatus[node.id] = 'failed';
          results.push({
            nodeId: node.id,
            agent: node.agent,
            status: 'failed',
            answer: `Unknown agent '${node.agent}'.`,
          });
          opts.emit?.('plan', { nodeId: node.id, agent: node.agent, state: 'failed' });
          return;
        }

        try {
          const prior = results
            .filter((r) => r.status === 'done')
            .map((r) => `- ${r.nodeId}/${r.agent}: ${r.answer.slice(0, 500)}`)
            .join('\n');
          const brief =
            `${node.brief}\n\n` +
            (prior ? `<PriorWaveResults>\n${prior}\n</PriorWaveResults>\n` : '') +
            'Write durable IDs/results to blackboard.write when available.';
          const result = await runSubAgentTask({
            manifest,
            callerCtx: opts.ctx,
            brief,
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
          nodeStatus[node.id] = 'done';
          results.push({
            nodeId: node.id,
            agent: node.agent,
            status: 'done',
            answer: result.answer,
            confidence: result.confidence,
            escalate: result.escalate,
          });
          if (env.FF_AGENT_BLACKBOARD) {
            await mergeBlackboard(
              { ...opts.ctx, actingAgent: node.agent },
              opts.conversationId,
              {
                artifacts: [{ key: `plan/${node.id}`, value: result.answer.slice(0, 2000) }],
                facts: { [`last_${node.agent}_summary`]: result.answer.slice(0, 500) },
                nodeStatus: { [node.id]: 'done' },
              },
            );
          }
          opts.emit?.('plan', { nodeId: node.id, agent: node.agent, state: 'done' });
          opts.emit?.('agent', { key: node.agent, state: 'done', label: node.agent });
        } catch (err) {
          logger.warn({ err, nodeId: node.id, agent: node.agent }, 'hard DAG node failed');
          nodeStatus[node.id] = 'failed';
          results.push({
            nodeId: node.id,
            agent: node.agent,
            status: 'failed',
            answer: errorMessage(err),
          });
          opts.emit?.('plan', { nodeId: node.id, agent: node.agent, state: 'failed' });
        }
      }),
    );
    await persistStatus();
  }

  return {
    plan,
    planId: opts.planId,
    nodeStatus,
    results,
    replanCount,
    waveResultsXml:
      formatExecutionPlanXml(plan) +
      '\n' +
      formatWaveResultsXml(results) +
      '\n<PlanHint>Wave execution finished. Synthesize one final user answer from WaveResults and Blackboard. Do NOT re-run completed nodes. Do NOT call plan_propose unless a remaining gap truly needs a new specialist.</PlanHint>',
  };
}

/** Soft-path hint when hard DAG is off. */
export { orchestrationHint } from './planExecutor.js';
