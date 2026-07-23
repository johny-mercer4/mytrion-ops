import { z } from 'zod';
import { env } from '../../../config/env.js';
import { getAgentContext } from '../../agents/context.js';
import { loadBlackboard, mergeBlackboard, type BlackboardPayload } from '../../agents/blackboard.js';
import type { ToolManifest } from '../types.js';

const readInput = z.object({});
const readOutput = z.object({
  enabled: z.boolean(),
  payload: z.record(z.unknown()),
});

const writeInput = z.object({
  goal: z.string().max(2000).optional(),
  planId: z.string().max(80).optional(),
  facts: z.record(z.unknown()).optional(),
  artifacts: z
    .array(z.object({ key: z.string().min(1).max(120), value: z.unknown() }))
    .max(20)
    .optional(),
  openQuestions: z.array(z.string().max(500)).max(20).optional(),
  replaceFacts: z.boolean().optional(),
});

const writeOutput = z.object({
  ok: z.boolean(),
  payload: z.record(z.unknown()),
});

function requireConversationId(): string {
  const run = getAgentContext();
  const id = run?.conversationId;
  if (!id) throw new Error('blackboard tools require an active agent conversation');
  return id;
}

export const blackboardReadTool: ToolManifest<
  z.infer<typeof readInput>,
  z.infer<typeof readOutput>
> = {
  name: 'blackboard.read',
  description:
    'Read the shared conversation blackboard (goal, facts, artifacts from other specialists). ' +
    'Use this before re-fetching data another agent already stored.',
  inputSchema: readInput,
  outputSchema: readOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  async handler(_input, ctx) {
    if (!env.FF_AGENT_BLACKBOARD) {
      return { enabled: false, payload: {} };
    }
    const payload: BlackboardPayload = await loadBlackboard(ctx, requireConversationId());
    return { enabled: true, payload };
  },
};

export const blackboardWriteTool: ToolManifest<
  z.infer<typeof writeInput>,
  z.infer<typeof writeOutput>
> = {
  name: 'blackboard.write',
  description:
    'Merge-patch the shared conversation blackboard. Write durable intermediate IDs/results ' +
    '(carrier_id, deal_id, balances, status) so the orchestrator and other specialists can reuse them. ' +
    'Namespace private keys as "<your-agent-key>/…"; shared facts use bare keys.',
  inputSchema: writeInput,
  outputSchema: writeOutput,
  // Conversation-scoped working state (like todos) — not an external system write.
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: [],
  async handler(input, ctx) {
    if (!env.FF_AGENT_BLACKBOARD) {
      return { ok: false, payload: {} };
    }
    const artifacts = input.artifacts?.map((a) => ({
      key: a.key,
      value: a.value ?? null,
    }));
    const payload = await mergeBlackboard(ctx, requireConversationId(), {
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
      ...(input.planId !== undefined ? { planId: input.planId } : {}),
      ...(input.facts !== undefined ? { facts: input.facts } : {}),
      ...(artifacts !== undefined ? { artifacts } : {}),
      ...(input.openQuestions !== undefined ? { openQuestions: input.openQuestions } : {}),
      ...(input.replaceFacts !== undefined ? { replaceFacts: input.replaceFacts } : {}),
    });
    return { ok: true, payload };
  },
};
