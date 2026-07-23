/**
 * Shared JSON blackboard for Horizon AI supervisor↔worker handoffs (FF_AGENT_BLACKBOARD).
 * Agents write durable intermediate IDs/results here instead of stuffing them into chat history.
 */
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { agentBlackboardRepo } from '../../repos/agentBlackboardRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export const blackboardArtifactSchema = z.object({
  key: z.string().min(1).max(120),
  value: z.unknown(),
  sourceAgent: z.string().min(1).max(80),
  at: z.string().datetime().or(z.string().min(1)),
});

export const blackboardPayloadSchema = z.object({
  goal: z.string().max(2000).default(''),
  planId: z.string().max(80).optional(),
  plan: z.unknown().optional(),
  facts: z.record(z.unknown()).default({}),
  artifacts: z.array(blackboardArtifactSchema).max(40).default([]),
  openQuestions: z.array(z.string().max(500)).max(20).default([]),
  nodeStatus: z.record(z.enum(['pending', 'running', 'done', 'failed', 'skipped'])).optional(),
});

export type BlackboardPayload = z.infer<typeof blackboardPayloadSchema>;

export function emptyBlackboard(): BlackboardPayload {
  return { goal: '', facts: {}, artifacts: [], openQuestions: [] };
}

export function parseBlackboard(raw: unknown): BlackboardPayload {
  const parsed = blackboardPayloadSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : emptyBlackboard();
}

function capPayload(payload: BlackboardPayload): BlackboardPayload {
  let json = JSON.stringify(payload);
  if (json.length <= env.AGENT_BLACKBOARD_MAX_CHARS) return payload;
  // Drop oldest artifacts first, then truncate openQuestions.
  const next = { ...payload, artifacts: [...payload.artifacts], openQuestions: [...payload.openQuestions] };
  while (next.artifacts.length > 0 && JSON.stringify(next).length > env.AGENT_BLACKBOARD_MAX_CHARS) {
    next.artifacts.shift();
  }
  while (next.openQuestions.length > 0 && JSON.stringify(next).length > env.AGENT_BLACKBOARD_MAX_CHARS) {
    next.openQuestions.shift();
  }
  json = JSON.stringify(next);
  if (json.length > env.AGENT_BLACKBOARD_MAX_CHARS) {
    next.goal = next.goal.slice(0, 400);
    next.facts = Object.fromEntries(Object.entries(next.facts).slice(0, 12));
  }
  return next;
}

/** Compact XML for the turn brief (never throws). */
export function formatBlackboardXml(payload: BlackboardPayload): string {
  const facts = Object.entries(payload.facts)
    .slice(0, 16)
    .map(([k, v]) => `    <Fact key="${k}">${typeof v === 'string' ? v : JSON.stringify(v)}</Fact>`)
    .join('\n');
  const arts = payload.artifacts
    .slice(-12)
    .map(
      (a) =>
        `    <Artifact key="${a.key}" source="${a.sourceAgent}">${
          typeof a.value === 'string' ? a.value : JSON.stringify(a.value)
        }</Artifact>`,
    )
    .join('\n');
  return [
    '<Blackboard>',
    payload.goal ? `  <Goal>${payload.goal}</Goal>` : '',
    payload.planId ? `  <PlanId>${payload.planId}</PlanId>` : '',
    facts ? `  <Facts>\n${facts}\n  </Facts>` : '',
    arts ? `  <Artifacts>\n${arts}\n  </Artifacts>` : '',
    payload.openQuestions.length
      ? `  <OpenQuestions>${payload.openQuestions.join('; ')}</OpenQuestions>`
      : '',
    '</Blackboard>',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function loadBlackboard(
  ctx: TenantContext,
  conversationId: string,
): Promise<BlackboardPayload> {
  if (!env.FF_AGENT_BLACKBOARD) return emptyBlackboard();
  try {
    const row = await agentBlackboardRepo.get(ctx, conversationId);
    return parseBlackboard(row?.payload);
  } catch (err) {
    logger.warn({ err, conversationId }, 'blackboard load failed');
    return emptyBlackboard();
  }
}

export async function saveBlackboard(
  ctx: TenantContext,
  conversationId: string,
  payload: BlackboardPayload,
): Promise<BlackboardPayload> {
  if (!env.FF_AGENT_BLACKBOARD) return payload;
  const capped = capPayload(parseBlackboard(payload));
  await agentBlackboardRepo.upsert(ctx, conversationId, capped);
  return capped;
}

export interface BlackboardWritePatch {
  goal?: string;
  planId?: string;
  plan?: unknown;
  facts?: Record<string, unknown>;
  artifacts?: Array<{ key: string; value: unknown }>;
  openQuestions?: string[];
  nodeStatus?: BlackboardPayload['nodeStatus'];
  /** Replace facts entirely when true. */
  replaceFacts?: boolean;
}

/**
 * Merge-patch. Writers may set shared facts + their own artifact keys;
 * `sourceAgent` is stamped from the narrowed acting agent (never trusted from input).
 */
export async function mergeBlackboard(
  ctx: TenantContext,
  conversationId: string,
  patch: BlackboardWritePatch,
): Promise<BlackboardPayload> {
  const current = await loadBlackboard(ctx, conversationId);
  const sourceAgent = ctx.actingAgent ?? 'orchestrator';
  const next: BlackboardPayload = {
    ...current,
    facts: { ...current.facts },
    artifacts: [...current.artifacts],
    openQuestions: [...current.openQuestions],
    nodeStatus: { ...(current.nodeStatus ?? {}) },
  };

  if (typeof patch.goal === 'string') next.goal = patch.goal.slice(0, 2000);
  if (typeof patch.planId === 'string') next.planId = patch.planId;
  if (patch.plan !== undefined) next.plan = patch.plan;
  if (patch.nodeStatus) next.nodeStatus = { ...next.nodeStatus, ...patch.nodeStatus };

  if (patch.facts) {
    if (patch.replaceFacts) {
      next.facts = { ...patch.facts };
    } else {
      for (const [k, v] of Object.entries(patch.facts)) {
        // Namespace agent-private keys under agentKey/; shared facts are bare keys.
        if (k.includes('/') && !k.startsWith(`${sourceAgent}/`) && sourceAgent !== 'orchestrator') {
          continue;
        }
        next.facts[k] = v;
      }
    }
  }

  if (patch.artifacts?.length) {
    const now = new Date().toISOString();
    for (const a of patch.artifacts) {
      const key = a.key.slice(0, 120);
      next.artifacts = next.artifacts.filter((x) => x.key !== key);
      next.artifacts.push({ key, value: a.value, sourceAgent, at: now });
    }
  }

  if (patch.openQuestions) {
    next.openQuestions = patch.openQuestions.map((q) => q.slice(0, 500)).slice(0, 20);
  }

  return saveBlackboard(ctx, conversationId, next);
}
