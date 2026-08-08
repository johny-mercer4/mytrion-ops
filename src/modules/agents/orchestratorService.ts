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
import { validateCitations, type WireCitation } from '../knowledge/agentic/citationCheck.js';
import { verifyAnswerFaithfulness } from '../knowledge/agentic/faithfulness.js';
import { routeRetrievalIntent } from '../knowledge/agentic/router.js';
import { costTracker } from '../llm/costTracker.js';
import { agentRegistry } from './agentRegistry.js';
import { narrowContext } from './authority.js';
import { BudgetExceededError, BudgetMeter } from './budget.js';
import { buildTurnBrief, recentHistorySummary, shouldReciteGoal } from './briefBuilder.js';
import { formatBlackboardXml, loadBlackboard, mergeBlackboard, type BlackboardPayload } from './blackboard.js';
import { ensureCheckpointerReady, getCheckpointer, threadIdFor } from './checkpointer.js';
import { runWithAgentContext, type RunCollector } from './context.js';
import { resolveAgentModelId } from './models.js';
import { buildOrchestrator, buildSingleAgent } from './orchestrator.js';
import { RunTracker } from './runTracker.js';
import type { Elicitation } from './elicitation.js';
import { maybeBuildPlan } from './planning/planner.js';
import { orchestrationHint } from './planning/planExecutor.js';
import { runHardDagWaves } from './planning/waveRunner.js';
import { captureSkill, recallSkillHint } from './skillCache.js';
import { consumeAgentStream, type StreamOutcome } from './streamAdapter.js';
import { isAgentKey, type AgentManifest } from './types.js';
import { createTurnContext, type ContextNoMatch } from './turnContext.js';
import { createTurnTraceEmitter } from './turnInspection.js';
import { casualFastReply } from './casualFastPath.js';
import { knownNoMatchesFrom } from './noMatchHistory.js';
import { presentAgentError } from './agentError.js';

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
  toolCalls: Array<{ name: string; status: string; args?: unknown }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalCost: number;
    cachedPromptTokens?: number;
    cacheHitRate?: number | null;
  };
  /** Knowledge passages retrieved across the run (the widget's grounding count). */
  ragPassages: number;
  /** Validated sources backing the answer (post-run [Sn] marker check). */
  citations: WireCitation[];
  /** Additive RAG v2 envelope; older clients may ignore it. */
  rag: {
    traceId: string | null;
    mode: 'none' | 'knowledge' | 'tool' | 'external';
    grade: string | null;
    confidence: number | null;
    abstained: boolean;
  };
  /** Present when the agent asked the user to pick from options (generative UI). */
  elicitation?: Elicitation;
  /** Safe client status; raw provider diagnostics remain server-side only. */
  error?: { message: string; retryable: boolean };
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

  const routeDecision = routeRetrievalIntent(message);
  const fastReply = manifest ? null : casualFastReply(message, opts.userName ?? ctx.userName);
  const orchestratorModelRole = !manifest && routeDecision.route === 'none' ? 'casual' : 'answer';
  const modelId = fastReply?.model ?? resolveAgentModelId(manifest, orchestratorModelRole);
  const budget = new BudgetMeter();
  const agentRunId = createId();
  const inspect = createTurnTraceEmitter(ctx, sse, agentRunId);
  inspect?.({
    stage: 'route', status: 'complete', label: fastReply ? 'Local greeting fast path' : `Routed to ${agentKey}`,
    agent: agentKey, model: modelId, modelRole: fastReply ? 'deterministic' : manifest ? 'answer' : orchestratorModelRole,
    provider: fastReply ? 'local' : modelId.includes('/') ? 'groq' : modelId.startsWith('glm-') ? 'glm' : 'openai',
    route: routeDecision.route, ragUsed: false,
    details: { contextV2: env.FF_RAG_V2_CONTEXT, retrievalV2: env.FF_RAG_V2_RETRIEVAL, claimVerification: env.FF_RAG_CLAIM_VERIFY },
  });
  const tracker = new RunTracker(modelId, budget, {
    ctx,
    agentRunId,
    conversationId: conv.id,
    role: fastReply ? 'deterministic' : manifest ? 'answer' : orchestratorModelRole,
    ...(inspect ? { inspect } : {}),
  });
  const startedAt = Date.now();

  await messageStore.appendUser(ctx, conv.id, message, opts.departmentScope);

  const checkpointing = !fastReply && Boolean(getCheckpointer());
  // Idempotent, memoized: guarantees the langgraph schema exists even though scripts/migrate.ts
  // isn't in the runtime image (deploy applies drizzle migrations only).
  if (checkpointing) await ensureCheckpointerReady();
  const historySummary =
    !checkpointing && opts.conversationId ? await recentHistorySummary(ctx, conv.id) : '';

  const isOrchestrator = !manifest;
  const allowedAgentKeys = agentRegistry.listForContext(ctx).map((m) => m.key);

  // Shared blackboard snapshot for the brief (flag-gated).
  let blackboardXml: string | undefined;
  let blackboard: BlackboardPayload | undefined;
  if (!fastReply && env.FF_AGENT_BLACKBOARD) {
    const board = await loadBlackboard(ctx, conv.id);
    if (!board.goal) {
      await mergeBlackboard({ ...ctx, actingAgent: 'orchestrator' }, conv.id, {
        goal: message.slice(0, 500),
      });
    }
    const refreshed = await loadBlackboard(ctx, conv.id);
    blackboard = refreshed;
    blackboardXml = formatBlackboardXml(refreshed);
  }

  // Goal re-anchoring every Nth user turn.
  let goalRecite: string | undefined;
  if (!fastReply && shouldReciteGoal(conv.messageCount)) {
    const board = env.FF_AGENT_BLACKBOARD ? await loadBlackboard(ctx, conv.id) : null;
    const goal = board?.goal || message.slice(0, 240);
    const step = board?.planId
      ? `You have an active plan (${board.planId}). Continue the next ready step.`
      : 'Continue toward that goal; do not restart from scratch.';
    goalRecite = `Reminder: Your overarching goal is "${goal}". ${step}`;
  }

  // Procedural skill hint (suggestion only).
  const cachedSkillXml = fastReply ? undefined : (await recallSkillHint(ctx, agentKey, message)) || undefined;
  // Filled during the run: elicitation by choice tools, citations by knowledge_search,
  // warnings by degraded construction (e.g. Composio unreachable).
  const collect: RunCollector = {};
  // Prompt identity is projected only from the canonical server context. Request-body identity
  // options remain compatibility inputs to caller-context resolution and cannot become trusted XML.
  const promptCtx = manifest ? narrowContext(ctx, manifest) : ctx;
  const turnProfile = promptCtx.profiles?.join(', ');
  const turnContext = env.FF_RAG_V2_CONTEXT
    ? createTurnContext({
        ctx: promptCtx,
        message,
        ...(historySummary ? { historySummary } : {}),
        ...(promptCtx.userName ? { userName: promptCtx.userName } : {}),
        zohoUserId: promptCtx.userId,
        ...(turnProfile ? { profile: turnProfile } : {}),
        role: promptCtx.callerRole ?? promptCtx.role,
        ...(promptCtx.client ? { client: promptCtx.client } : {}),
        knownNoMatch: knownNoMatchesFrom(blackboard),
        ...(blackboard
          ? {
              toolFacts: blackboard.artifacts.slice(-16).map((artifact) => ({
                key: artifact.key,
                value: artifact.value,
                source: artifact.sourceAgent,
                fetchedAt: artifact.at,
              })),
              openQuestions: blackboard.openQuestions,
            }
          : {}),
      })
    : undefined;

  sse?.send('status', { state: 'running' });

  // Wall-clock deadline as a real abort: assertOk() only runs on tool calls / charges, so a
  // single long model generation would otherwise outlive the budget. The signal propagates
  // through LangGraph's RunnableConfig to model/tool nodes.
  const wallAbort = new AbortController();
  const wallTimer = setTimeout(() => wallAbort.abort(), budget.remainingWallMs());

  let outcome: StreamOutcome;
  let status: 'ok' | 'error' = 'ok';
  let errorMsg: string | undefined;
  if (fastReply) {
    outcome = { finalText: fastReply.message, toolCalls: [], agentPath: [], childTexts: [] };
    inspect?.({
      stage: 'model', status: 'complete', label: 'Answered without an LLM call',
      agent: agentKey, model: modelId, modelRole: 'deterministic', provider: 'local',
      route: 'none', ragUsed: false, durationMs: Date.now() - startedAt,
    });
  } else try {
    outcome = await runWithAgentContext(
      {
        ctx,
        conversationId: conv.id,
        budget,
        agentRunId,
        collect,
        ...(inspect ? { inspect } : {}),
        ...(turnContext ? { turnContext } : {}),
        ...(sse ? { emit: (event: string, data: unknown) => sse.send(event, data) } : {}),
      },
      async () => {
        // Pre-invoke planner (complex orchestrator turns only) — seeds <ExecutionPlan>.
        const planSeed = await maybeBuildPlan({
          message,
          ctx,
          conversationId: conv.id,
          allowedAgentKeys,
          isOrchestrator,
          ...(sse ? { emit: (event: string, data: unknown) => sse.send(event, data) } : {}),
        });

        // Hard DAG: deterministically execute ready waves, then synthesize.
        let hardDagXml: string | undefined;
        let hardDagHint: string | undefined;
        if (
          planSeed &&
          isOrchestrator &&
          env.FF_AGENT_HARD_DAG &&
          env.FF_AGENT_PLAN_DAG
        ) {
          const hard = await runHardDagWaves({
            plan: planSeed.plan,
            planId: planSeed.planId,
            message,
            ctx,
            conversationId: conv.id,
            allowedAgentKeys,
            signal: wallAbort.signal,
            ...(sse ? { emit: (event: string, data: unknown) => sse.send(event, data) } : {}),
          });
          for (const r of hard.results) {
            if (r.status === 'done' && !tracker.agentPath.includes(r.agent)) {
              tracker.agentPath.push(r.agent);
            }
          }
          hardDagXml = hard.waveResultsXml;
          hardDagHint =
            'Specialist waves already ran. Synthesize the final answer from <WaveResults> and <Blackboard>. ' +
            'Do not re-delegate completed nodes.';
        }

        const brief = buildTurnBrief({
          message,
          ...(turnContext ? { turnContext } : {}),
          ...(opts.userName ?? ctx.userName ? { userName: opts.userName ?? ctx.userName } : {}),
          ...(opts.zohoUserId ?? ctx.userId ? { zohoUserId: opts.zohoUserId ?? ctx.userId } : {}),
          ...(opts.profile ?? ctx.profiles?.[0] ? { profile: opts.profile ?? ctx.profiles?.[0] } : {}),
          ...(opts.role ?? ctx.role ? { role: opts.role ?? ctx.role } : {}),
          departments: ctx.departments,
          ...(historySummary ? { historySummary } : {}),
          ...(ctx.client ? { clientContext: ctx.client } : {}),
          ...(blackboardXml ? { blackboardXml } : {}),
          ...(cachedSkillXml ? { cachedSkillXml } : {}),
          ...(goalRecite ? { goalRecite } : {}),
          ...(hardDagXml
            ? { executionPlanXml: hardDagXml, planHint: hardDagHint }
            : planSeed
              ? { executionPlanXml: planSeed.xml, planHint: orchestrationHint(planSeed.plan) }
              : {}),
        });

        const agent = manifest
          ? await buildSingleAgent(manifest, ctx)
          : (await buildOrchestrator(ctx, orchestratorModelRole)).agent;
        // recursionLimit is the hard graph-depth backstop (deepagents' default is ~unbounded).
        // LangGraph counts EVERY super-step (model node, tool node, deepagents middleware), so one
        // tool round is several steps — the cap is tool-call rounds converted to graph steps with
        // generous headroom. The BudgetMeter (tool-call count / cost / wall-time) is the real
        // semantic runaway guard; this just prevents an infinite graph.
        const childCap = manifest?.maxIterations ?? env.AGENT_MAX_CHILD_ITERATIONS;
        // After hard DAG, synthesis needs fewer hops.
        const recursionLimit = hardDagXml
          ? 24
          : manifest
            ? childCap * 5 + 10
            : childCap * 6 + 24;
        const events = agent.streamEvents(
          { messages: [{ role: 'user', content: brief }] },
          {
            version: 'v2',
            callbacks: [tracker],
            recursionLimit,
            signal: wallAbort.signal,
            ...(checkpointing ? { configurable: { thread_id: threadIdFor(ctx.tenantId, conv.id) } } : {}),
          },
        );
        return consumeAgentStream(events, sse);
      },
    );
  } catch (err) {
    status = 'error';
    // LangGraph/deepagents wraps tool errors (MiddlewareError etc.), so a budget breach may reach
    // us via err.cause rather than as a direct instance — unwrap the chain to detect it. A fired
    // wall deadline surfaces as an abort, not a BudgetExceededError, so check the signal too.
    const wallHit = wallAbort.signal.aborted;
    errorMsg = wallHit ? 'the run hit its wall-clock time limit' : errorMessage(err);
    const budgetHit = hasBudgetCause(err) || wallHit;
    const friendly = presentAgentError(errorMsg, budgetHit);
    outcome = { finalText: friendly, toolCalls: [], agentPath: tracker.agentPath, childTexts: [] };
    inspect?.({ stage: 'error', status: 'error', label: friendly });
    logger.warn({ err: errorMsg, agentKey, budgetHit }, 'agent turn failed');
  } finally {
    clearTimeout(wallTimer);
  }

  // A tool asked the user to choose (generative UI) — surface the picker on the result + stream.
  if (collect.elicitation) {
    outcome.elicitation = collect.elicitation;
    sse?.send('elicitation', collect.elicitation);
  }

  // Construction-time degradations (e.g. Composio unreachable) — tell the user + audit.
  if (collect.warnings?.length) {
    sse?.send('status', { state: 'degraded', warnings: collect.warnings });
  }

  // Post-hoc grounding check: strip [Sn] markers that don't map to a passage retrieved this
  // run. Streamed tokens may still contain them — `done.message` is the canonical text and
  // the widget re-renders from it.
  const validated = validateCitations(
    outcome.finalText || 'The agent produced no answer.',
    collect.citations ?? [],
    // Recover the specialists' own markers when the orchestrator paraphrased them away, so the
    // sources list stays as narrow as what actually backed the answer.
    { markerFallbackTexts: outcome.childTexts },
  );
  if (validated.strippedMarkers.length > 0) {
    logger.warn(
      { agentKey, agentRunId, strippedMarkers: validated.strippedMarkers },
      'stripped citation markers not backed by retrieved passages',
    );
  }
  let finalText = validated.text || 'The agent produced no answer.';
  const faithfulness = collect.rag
    ? await verifyAnswerFaithfulness(finalText, collect.ragEvidence ?? [])
    : { text: finalText, coverage: 1, repaired: false, abstained: false, unsupportedClaims: [] };
  finalText = faithfulness.text;
  if (collect.rag && faithfulness.abstained) collect.rag.abstained = true;
  const usage = {
    promptTokens: tracker.promptTokens,
    completionTokens: tracker.completionTokens,
    totalCost: tracker.totalCost(),
    cachedPromptTokens: tracker.cachedPromptTokens,
    cacheHitRate: tracker.cacheHitRate(),
  };
  inspect?.({
    stage: 'verification', status: 'complete',
    label: collect.rag ? 'Grounded claims verified' : 'No RAG evidence to verify',
    ragUsed: (collect.ragPassages ?? 0) > 0,
    ...(collect.rag?.grade ? { ragGrade: collect.rag.grade } : {}),
    ...(collect.rag?.confidence !== undefined ? { confidence: collect.rag.confidence } : {}), passages: collect.ragPassages ?? 0,
    details: { coverage: faithfulness.coverage, repaired: faithfulness.repaired, abstained: faithfulness.abstained },
  });

  // Persistence + bookkeeping are best-effort: the user already has the answer.
  try {
    await messageStore.appendAssistant(ctx, conv.id, {
      content: finalText,
      model: modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      tools: outcome.toolCalls,
      ...(collect.ragPassages !== undefined ? { ragPassages: collect.ragPassages } : {}),
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
    if (
      env.FF_AGENT_BLACKBOARD &&
      turnContext &&
      collect.rag?.mode === 'knowledge' &&
      (collect.rag.grade === 'not_documented' || collect.rag.grade === 'irrelevant')
    ) {
      const miss: ContextNoMatch = {
        query: turnContext.task.resolvedAsk.slice(0, 1_000),
        scopeFingerprint: collect.rag.scopeFingerprint,
        at: new Date().toISOString(),
      };
      const known = turnContext.state.knownNoMatch.filter((item) =>
        item.query !== miss.query || item.scopeFingerprint !== miss.scopeFingerprint,
      );
      await mergeBlackboard({ ...ctx, actingAgent: 'orchestrator' }, conv.id, {
        facts: { 'rag/knownNoMatch': [...known, miss].slice(-24) },
      });
    }
    await auditFromContext(ctx, {
      action: 'agent.turn',
      status,
      agentRunId,
      detail: {
        agentKey,
        agentPath: outcome.agentPath,
        tools: outcome.toolCalls.length,
        durationMs: Date.now() - startedAt,
        ...(collect.warnings?.length ? { warnings: collect.warnings } : {}),
        ...(validated.strippedMarkers.length > 0
          ? { strippedMarkers: validated.strippedMarkers }
          : {}),
        faithfulnessCoverage: faithfulness.coverage,
        faithfulnessRepaired: faithfulness.repaired,
        ...(faithfulness.unsupportedClaims.length > 0
          ? { unsupportedClaimCount: faithfulness.unsupportedClaims.length }
          : {}),
      },
    });
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'agent: turn bookkeeping failed');
  }

  if (status === 'ok') {
    // Fire-and-forget distillation — memory must never delay or fail a turn.
    const { distillMemories } = await import('./memory.js');
    void distillMemories(ctx, agentKey, message, finalText);
    void captureSkill(ctx, agentKey, message, finalText, outcome.toolCalls);
  }

  const result: AgentTurnResult = {
    conversationId: conv.id,
    message: finalText,
    agentKey,
    agentPath: outcome.agentPath,
    toolCalls: outcome.toolCalls,
    usage,
    ragPassages: collect.ragPassages ?? 0,
    citations: validated.usedCitations,
    rag: collect.rag
      ? {
          traceId: collect.rag.traceId,
          mode: collect.rag.mode,
          grade: collect.rag.grade,
          confidence: collect.rag.confidence,
          abstained: collect.rag.abstained,
        }
      : { traceId: null, mode: 'none', grade: null, confidence: null, abstained: false },
    ...(outcome.elicitation ? { elicitation: outcome.elicitation } : {}),
    ...(status === 'error' ? { error: { message: 'This response failed. Please retry.', retryable: true } } : {}),
  };
  inspect?.({
    stage: 'complete', status: status === 'ok' ? 'complete' : 'error', label: 'Turn complete',
    agent: outcome.agentPath.at(-1) ?? agentKey, model: modelId,
    route: collect.rag?.mode ?? routeDecision.route,
    ragUsed: result.ragPassages > 0,
    ...(result.rag.grade ? { ragGrade: result.rag.grade } : {}),
    ...(result.rag.confidence !== null ? { confidence: result.rag.confidence } : {}), passages: result.ragPassages,
    durationMs: Date.now() - startedAt,
    details: { tools: result.toolCalls.length, citations: result.citations.length, totalCost: usage.totalCost },
  });
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
