/**
 * One multi-agent turn: agent selection RBAC → conversation persistence → orchestrator (or
 * direct-to-child) run → SSE/JSON result, with budget guards, cost tracking, and an agent_runs
 * row. Mirrors chatService's persistence contract so the widget transcript looks identical
 * regardless of which pipeline served the turn.
 */
import { createId } from '@paralleldrive/cuid2';
import { env } from '../../config/env.js';
import { errorMessage, RBACError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { Conversation } from '../../db/schema/index.js';
import { agentRunRepo } from '../../repos/agentRunRepo.js';
import { conversationRepo, type CreateConversationInput } from '../../repos/conversationRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { messageStore } from '../chat/messageStore.js';
import type { SSEStream } from '../chat/streaming.js';
import { costTracker } from '../llm/costTracker.js';
import { agentRegistry } from './agentRegistry.js';
import { BudgetExceededError, BudgetMeter } from './budget.js';
import { buildTurnBrief, recentHistorySummary } from './briefBuilder.js';
import { ensureCheckpointerReady, getCheckpointer, threadIdFor } from './checkpointer.js';
import { runWithAgentContext } from './context.js';
import { resolveAgentModelId } from './models.js';
import { buildOrchestrator, buildSingleAgent } from './orchestrator.js';
import { RunTracker } from './runTracker.js';
import { consumeAgentStream, type StreamOutcome } from './streamAdapter.js';
import { isAgentKey, type AgentManifest } from './types.js';

export interface AgentTurnOptions {
  conversationId?: string;
  /** Direct-to-child mode: run exactly this department agent (RBAC-checked). */
  agent?: string;
  userName?: string;
  zohoUserId?: string;
  profile?: string;
  role?: string;
  departmentScope?: string | string[];
}

export interface AgentTurnResult {
  conversationId: string;
  message: string;
  /** 'orchestrator' or the direct child key, plus the specialists actually consulted. */
  agentKey: string;
  agentPath: string[];
  toolCalls: Array<{ name: string; status: string }>;
  usage: { promptTokens: number; completionTokens: number; totalCost: number };
}

/** Resolve + RBAC-check the requested child agent; audit denials. */
async function resolveRequestedAgent(
  ctx: TenantContext,
  agent: string | undefined,
): Promise<AgentManifest | undefined> {
  if (agent === undefined) return undefined;
  const manifest = isAgentKey(agent) ? agentRegistry.get(agent) : undefined;
  if (!manifest) {
    await auditFromContext(ctx, { action: 'agent.select', status: 'denied', detail: { agent, reason: 'unknown agent' } });
    throw new RBACError(`Unknown agent '${agent}'`);
  }
  const access = agentRegistry.checkAccess(manifest, ctx);
  if (!access.ok) {
    await auditFromContext(ctx, { action: 'agent.select', status: 'denied', detail: { agent, reason: access.reason } });
    throw new RBACError(access.reason ?? `Access to agent '${agent}' denied`);
  }
  return manifest;
}

function conversationMeta(ctx: TenantContext, opts: AgentTurnOptions): CreateConversationInput {
  const meta: CreateConversationInput = {};
  if (opts.zohoUserId) meta.zohoUserId = opts.zohoUserId;
  const userName = opts.userName ?? ctx.userName;
  if (userName) meta.userName = userName;
  if (opts.profile) meta.profile = opts.profile;
  if (opts.role) meta.role = opts.role;
  if (opts.departmentScope !== undefined) meta.departmentScope = opts.departmentScope;
  return meta;
}

async function ensureConversation(
  ctx: TenantContext,
  conversationId: string | undefined,
  meta: CreateConversationInput,
): Promise<Conversation> {
  if (conversationId) {
    const conv = await conversationRepo.findOwned(ctx, conversationId);
    if (conv) return conv;
    logger.warn({ conversationId }, 'agent: unknown/foreign conversation id; creating a new one');
  }
  return conversationRepo.create(ctx, meta);
}

/** Walk the error cause chain to detect a budget breach wrapped by LangGraph middleware. */
function hasBudgetCause(err: unknown, depth = 0): boolean {
  if (depth > 5 || err == null) return false;
  if (err instanceof BudgetExceededError) return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause ? hasBudgetCause(cause, depth + 1) : false;
}

function deriveTitle(message: string): string {
  const clean = message.trim().replace(/\s+/g, ' ');
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

async function executeTurn(
  message: string,
  ctx: TenantContext,
  opts: AgentTurnOptions,
  sse?: SSEStream,
): Promise<AgentTurnResult> {
  const manifest = await resolveRequestedAgent(ctx, opts.agent);
  const conv = await ensureConversation(ctx, opts.conversationId, conversationMeta(ctx, opts));
  const agentKey = manifest?.key ?? 'orchestrator';
  sse?.send('start', { conversationId: conv.id, agent: agentKey });

  await messageStore.appendUser(ctx, conv.id, message, opts.departmentScope);

  const checkpointing = Boolean(getCheckpointer());
  // Idempotent, memoized: guarantees the langgraph schema exists even though scripts/migrate.ts
  // isn't in the runtime image (deploy applies drizzle migrations only).
  if (checkpointing) await ensureCheckpointerReady();
  const historySummary =
    !checkpointing && opts.conversationId ? await recentHistorySummary(ctx, conv.id) : '';
  const brief = buildTurnBrief({
    message,
    ...(opts.userName ?? ctx.userName ? { userName: opts.userName ?? ctx.userName } : {}),
    departments: ctx.departments,
    ...(historySummary ? { historySummary } : {}),
  });

  const budget = new BudgetMeter();
  const agentRunId = createId();
  const modelId = resolveAgentModelId(manifest);
  const tracker = new RunTracker(modelId, budget);
  const startedAt = Date.now();

  sse?.send('status', { state: 'running' });

  let outcome: StreamOutcome;
  let status: 'ok' | 'error' = 'ok';
  let errorMsg: string | undefined;
  try {
    outcome = await runWithAgentContext(
      { ctx, conversationId: conv.id, budget, agentRunId },
      async () => {
        const agent = manifest
          ? await buildSingleAgent(manifest, ctx)
          : (await buildOrchestrator(ctx)).agent;
        // recursionLimit is the hard graph-depth backstop (deepagents' default is ~unbounded).
        // LangGraph counts EVERY super-step (model node, tool node, deepagents middleware), so one
        // tool round is several steps — the cap is tool-call rounds converted to graph steps with
        // generous headroom. The BudgetMeter (tool-call count / cost / wall-time) is the real
        // semantic runaway guard; this just prevents an infinite graph.
        const childCap = manifest?.maxIterations ?? env.AGENT_MAX_CHILD_ITERATIONS;
        const recursionLimit = manifest ? childCap * 5 + 10 : childCap * 6 + 24;
        const events = agent.streamEvents(
          { messages: [{ role: 'user', content: brief }] },
          {
            version: 'v2',
            callbacks: [tracker],
            recursionLimit,
            ...(checkpointing ? { configurable: { thread_id: threadIdFor(ctx.tenantId, conv.id) } } : {}),
          },
        );
        return consumeAgentStream(events, sse);
      },
    );
  } catch (err) {
    status = 'error';
    errorMsg = errorMessage(err);
    // LangGraph/deepagents wraps tool errors (MiddlewareError etc.), so a budget breach may reach
    // us via err.cause rather than as a direct instance — unwrap the chain to detect it.
    const budgetHit = hasBudgetCause(err);
    const friendly = budgetHit
      ? `I had to stop early: ${errorMsg}. Here is what I have so far — please narrow the request.`
      : `The agent run failed: ${errorMsg}`;
    outcome = { finalText: friendly, toolCalls: [], agentPath: tracker.agentPath };
    logger.warn({ err: errorMsg, agentKey, budgetHit }, 'agent turn failed');
  }

  const finalText = outcome.finalText || 'The agent produced no answer.';
  const usage = {
    promptTokens: tracker.promptTokens,
    completionTokens: tracker.completionTokens,
    totalCost: tracker.totalCost(),
  };

  // Persistence + bookkeeping are best-effort: the user already has the answer.
  try {
    await messageStore.appendAssistant(ctx, conv.id, {
      content: finalText,
      model: modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      tools: outcome.toolCalls,
      ...(opts.departmentScope !== undefined ? { departmentScope: opts.departmentScope } : {}),
      ...(errorMsg !== undefined ? { error: errorMsg } : {}),
    });
    if (!conv.title) await conversationRepo.setTitle(ctx, conv.id, deriveTitle(message));
    await conversationRepo.bumpForTurn(ctx, conv.id, {
      ...(opts.departmentScope !== undefined ? { departmentScope: opts.departmentScope } : {}),
    });
    costTracker.record(ctx, {
      model: modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });
    await agentRunRepo.record(ctx, {
      id: agentRunId,
      conversationId: conv.id,
      ...(checkpointing ? { threadId: threadIdFor(ctx.tenantId, conv.id) } : {}),
      agentKey,
      status,
      model: modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalCost: usage.totalCost.toFixed(6),
      durationMs: Date.now() - startedAt,
    });
    await auditFromContext(ctx, {
      action: 'agent.turn',
      status,
      agentRunId,
      detail: {
        agentKey,
        agentPath: outcome.agentPath,
        tools: outcome.toolCalls.length,
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'agent: turn bookkeeping failed');
  }

  if (status === 'ok') {
    // Fire-and-forget distillation — memory must never delay or fail a turn.
    const { distillMemories } = await import('./memory.js');
    void distillMemories(ctx, agentKey, message, finalText);
  }

  const result: AgentTurnResult = {
    conversationId: conv.id,
    message: finalText,
    agentKey,
    agentPath: outcome.agentPath,
    toolCalls: outcome.toolCalls,
    usage,
  };
  sse?.send('done', result);
  return result;
}

export function runAgentTurn(
  message: string,
  ctx: TenantContext,
  opts: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  return executeTurn(message, ctx, opts);
}

export async function streamAgentTurn(
  message: string,
  ctx: TenantContext,
  sse: SSEStream,
  opts: AgentTurnOptions = {},
): Promise<void> {
  await executeTurn(message, ctx, opts, sse);
}

/** Exposed for the deprecated /v1/agent/deep alias. */
export const orchestratorEnabled = (): boolean =>
  env.FF_ORCHESTRATOR_ENABLED || env.FF_DEEP_AGENTS_ENABLED;
