/**
 * Bounded Corrective/Self-RAG controller. Scope is always server-owned; query rewrites can only
 * alter search text. Internal knowledge never falls back to the public web.
 */
import { createId } from '@paralleldrive/cuid2';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { ragRunRepo } from '../../../repos/ragRunRepo.js';
import type { RetrievalScope } from '../../../repos/knowledgeSearchRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { getAgentContext } from '../../agents/context.js';
import { scopeFingerprintFor } from '../../agents/turnContext.js';
import { privacyHash } from '../../llm/telemetry.js';
import { wrapUntrusted } from '../../security/untrusted.js';
import { assessEvidence, type EvidenceAssessment, type EvidenceGrade } from './evidenceAssessment.js';
import { hybridRetrieve } from './hybrid.js';
import { buildGroundingBlock } from './citations.js';
import { judgeEvidence, planQueries } from './queryPlanner.js';
import { rerankPassages } from './rerank.js';
import { routeRetrievalIntent } from './router.js';
import type { AgenticRetrievalResult, RetrievedPassage } from './types.js';

export interface AgenticRetrieveOptions {
  k?: number;
  /** Explicit external intent only. Kept separate from internal knowledge coverage. */
  allowExternalSearch?: boolean;
  /** Deprecated compatibility input; never enables internal-policy fallback. */
  allowWebFallback?: boolean;
  resolvedAsk?: string;
  /**
   * Set when the caller IS the agent's `knowledge_search` tool, i.e. the model has already decided it
   * wants documentation.
   *
   * `routeRetrievalIntent` was written to judge a USER utterance — "how do I…" keeps it on knowledge,
   * "how many gallons this month" sends it to a live tool. But a tool call carries the model's own
   * KEYWORD query ("client balance account cards"), which has no procedural markers and so reads as a
   * live-data aggregate. Measured: "How do I check a client's balance and see their card list?" ended
   * as `route: tool, abstained: true, hops: 0` in 3ms — the agent asked for documentation and got a
   * refusal, then answered with nothing cited.
   *
   * Deciding NOT to retrieve is the chat layer's job, before the tool is ever called. Once the model
   * has called it, honour the request.
   */
  explicitKnowledgeRequest?: boolean;
}

interface HopTrace {
  hop: number;
  queryHashes: string[];
  candidateIds: string[];
  grade: EvidenceGrade;
  confidence: number;
  reasons: string[];
}

async function externalFallback(query: string): Promise<string | undefined> {
  if (!env.FF_CRAG_WEB_FALLBACK) return undefined;
  try {
    const { runWebSearch } = await import('../../agents/tools/webSearch.js');
    const text = await runWebSearch(query);
    return text ? wrapUntrusted('web', text) : undefined;
  } catch (err) {
    logger.warn({ err }, 'explicit external RAG fallback failed');
    return undefined;
  }
}

function mergeCandidates(current: RetrievedPassage[], found: RetrievedPassage[]): RetrievedPassage[] {
  const byId = new Map(current.map((passage) => [passage.id, passage]));
  for (const passage of found) {
    const existing = byId.get(passage.id);
    if (!existing || passage.fusedScore > existing.fusedScore) byId.set(passage.id, passage);
  }
  return [...byId.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

function shouldUseDeterministic(assessment: EvidenceAssessment): boolean {
  return assessment.confidence >= 0.85 && assessment.grade !== 'irrelevant';
}

async function persistTrace(
  ctx: TenantContext,
  input: {
    traceId: string;
    question: string;
    route: AgenticRetrievalResult['route'];
    grade: EvidenceGrade;
    confidence: number;
    hops: number;
    candidateCount: number;
    selectedCount: number;
    durationMs: number;
    hopTrace: HopTrace[];
    abstained: boolean;
  },
): Promise<void> {
  const run = getAgentContext();
  try {
    await ragRunRepo.record(ctx, {
      id: input.traceId,
      ...(run?.conversationId ? { conversationId: run.conversationId } : {}),
      ...(run?.agentRunId ? { agentRunId: run.agentRunId } : {}),
      queryHash: privacyHash(input.question),
      route: input.route,
      grade: input.grade,
      confidence: input.confidence.toFixed(4),
      abstained: input.abstained,
      hops: input.hops,
      candidateCount: input.candidateCount,
      selectedCount: input.selectedCount,
      retrievalStrategy: env.RAG_RETRIEVAL_STRATEGY,
      durationMs: input.durationMs,
      stageTrace: {
        hops: input.hopTrace,
        routing: input.route,
        retrievalStrategy: env.RAG_RETRIEVAL_STRATEGY,
      },
    });
  } catch (err) {
    logger.warn({ err, traceId: input.traceId }, 'rag_runs telemetry write failed');
  }
}

function emptyResult(input: {
  traceId: string;
  scopeFingerprint: string;
  route: AgenticRetrievalResult['route'];
  grade: EvidenceGrade;
  confidence: number;
  note: string;
  webFallbackBlock?: string;
}): AgenticRetrievalResult {
  return {
    passages: [],
    citations: [],
    groundingBlock: input.note,
    hops: 0,
    sufficient: false,
    grade: input.grade,
    suggestWebSearch: input.route === 'external' && !input.webFallbackBlock,
    notDocumented: !input.webFallbackBlock,
    traceId: input.traceId,
    scopeFingerprint: input.scopeFingerprint,
    confidence: input.confidence,
    route: input.route,
    ...(input.webFallbackBlock ? { webFallbackBlock: input.webFallbackBlock } : {}),
  };
}

export async function agenticRetrieve(
  ctx: TenantContext,
  question: string,
  opts: AgenticRetrieveOptions = {},
): Promise<AgenticRetrievalResult> {
  const startedAt = Date.now();
  const traceId = createId();
  const scopeFingerprint = scopeFingerprintFor(ctx);
  const ask = opts.resolvedAsk?.trim() || question.trim();
  const routed = routeRetrievalIntent(ask);
  // A 'tool' verdict cannot override an explicit knowledge_search. 'none' (casual/empty) still
  // abstains: if the model searched for a greeting, retrieving is waste, not a lost answer.
  const route =
    opts.explicitKnowledgeRequest && routed.route === 'tool'
      ? { ...routed, route: 'knowledge' as const, reason: 'explicit-knowledge-request' }
      : routed;
  const k = opts.k ?? 6;

  if (route.route === 'none' || route.route === 'tool') {
    const note = route.route === 'tool'
      ? 'This request requires an authoritative live-data tool; knowledge retrieval was intentionally skipped.'
      : 'Knowledge retrieval was intentionally skipped for a casual request.';
    const result = emptyResult({
      traceId, scopeFingerprint, route: route.route, grade: 'not_documented', confidence: 1, note,
    });
    await persistTrace(ctx, {
      traceId, question: ask, route: route.route, grade: result.grade, confidence: 1,
      hops: 0, candidateCount: 0, selectedCount: 0, durationMs: Date.now() - startedAt,
      hopTrace: [], abstained: route.route === 'tool',
    });
    return result;
  }

  if (route.route === 'external') {
    const webFallbackBlock = opts.allowExternalSearch ? await externalFallback(ask) : undefined;
    const result = emptyResult({
      traceId,
      scopeFingerprint,
      route: 'external',
      grade: webFallbackBlock ? 'partial' : 'not_documented',
      confidence: webFallbackBlock ? 0.65 : 1,
      note: webFallbackBlock
        ? `External web evidence (not Octane policy):\n${webFallbackBlock}`
        : 'The request is external; no internal Octane evidence was used.',
      ...(webFallbackBlock ? { webFallbackBlock } : {}),
    });
    await persistTrace(ctx, {
      traceId, question: ask, route: 'external', grade: result.grade, confidence: result.confidence,
      hops: 0, candidateCount: 0, selectedCount: 0, durationMs: Date.now() - startedAt,
      hopTrace: [], abstained: !webFallbackBlock,
    });
    return result;
  }

  const knownNoMatch = getAgentContext()?.turnContext?.state.knownNoMatch.some((item) => {
    if (item.scopeFingerprint !== scopeFingerprint) return false;
    if (item.query.trim().replace(/\s+/g, ' ').toLowerCase() !== ask.replace(/\s+/g, ' ').toLowerCase()) return false;
    const recordedAt = Date.parse(item.at);
    return Number.isFinite(recordedAt) && Date.now() - recordedAt <= env.RAG_NO_MATCH_TTL_SECONDS * 1_000;
  });
  if (knownNoMatch) {
    const result = emptyResult({
      traceId,
      scopeFingerprint,
      route: 'knowledge',
      grade: 'not_documented',
      confidence: 1,
      note: 'The same authorized scope was recently searched without a match; retrieval was not repeated.',
    });
    await persistTrace(ctx, {
      traceId, question: ask, route: 'knowledge', grade: result.grade, confidence: 1,
      hops: 0, candidateCount: 0, selectedCount: 0, durationMs: Date.now() - startedAt,
      hopTrace: [], abstained: true,
    });
    return result;
  }

  let queries = await planQueries(ask);
  let candidates: RetrievedPassage[] = [];
  let hops = 0;
  let assessment: EvidenceAssessment = { grade: 'not_documented', confidence: 1, reasons: ['not searched'] };
  let missingQueries: string[] = [];
  let broadened = false;
  const hopTrace: HopTrace[] = [];

  while (hops < env.RAG_MAX_HOPS) {
    hops += 1;
    const scope: RetrievalScope | undefined = !env.FF_PLATFORM_KNOWLEDGE
      ? { domains: ['operations'] }
      : route.platformPreferred && !broadened
        ? { domains: ['platform'] }
        : undefined;
    const found = await hybridRetrieve(ctx, queries, env.RAG_CANDIDATES_PER_LEG, scope);
    candidates = mergeCandidates(candidates, found);
    assessment = assessEvidence(candidates.slice(0, k));
    if (!shouldUseDeterministic(assessment) && candidates.length > 0) {
      const judged = await judgeEvidence(ask, candidates.slice(0, k), assessment);
      assessment = judged;
      missingQueries = judged.missingQueries;
    } else {
      missingQueries = [];
    }
    hopTrace.push({
      hop: hops,
      queryHashes: queries.map(privacyHash),
      candidateIds: candidates.slice(0, 20).map((passage) => passage.id),
      grade: assessment.grade,
      confidence: assessment.confidence,
      reasons: assessment.reasons,
    });

    if (assessment.grade === 'sufficient' || assessment.grade === 'conflict' || assessment.grade === 'outdated') break;
    if (assessment.grade === 'partial' && missingQueries.length > 0 && hops < env.RAG_MAX_HOPS) {
      queries = missingQueries;
      continue;
    }
    if (!broadened && hops < env.RAG_MAX_HOPS) {
      broadened = true;
      queries = [ask];
      continue;
    }
    break;
  }

  let passages = assessment.grade === 'irrelevant' || assessment.grade === 'not_documented'
    ? []
    : await rerankPassages(ask, candidates, k);
  if (assessment.grade === 'partial' && passages.length > 0) {
    const topScore = passages[0]?.fusedScore ?? 0;
    passages = passages.filter((passage) => passage.fusedScore >= topScore * 0.6);
  }

  const { groundingBlock, citations } = buildGroundingBlock(passages);
  const notDocumented = passages.length === 0 || assessment.grade === 'not_documented' || assessment.grade === 'irrelevant';
  const notes: string[] = [groundingBlock];
  if (notDocumented) {
    notes.push('CRAG: The authorized internal corpus does not contain reliable support. State that the documentation does not specify the answer. Do not substitute public web content or invent policy.');
  } else if (assessment.grade === 'partial') {
    notes.push('CRAG: Evidence is partial. Answer only the supported portion and name what remains undocumented.');
  } else if (assessment.grade === 'conflict') {
    notes.push('CRAG: Sources conflict. Surface both versions with provenance; do not silently choose one.');
  } else if (assessment.grade === 'outdated') {
    notes.push('CRAG: Available evidence is stale or expired. Label it as outdated and request verification.');
  }

  const result: AgenticRetrievalResult = {
    passages,
    citations,
    groundingBlock: notes.filter(Boolean).join('\n\n'),
    hops,
    sufficient: assessment.grade === 'sufficient',
    grade: assessment.grade,
    suggestWebSearch: false,
    notDocumented,
    traceId,
    scopeFingerprint,
    confidence: assessment.confidence,
    route: 'knowledge',
  };
  await persistTrace(ctx, {
    traceId,
    question: ask,
    route: 'knowledge',
    grade: result.grade,
    confidence: result.confidence,
    hops,
    candidateCount: candidates.length,
    selectedCount: passages.length,
    durationMs: Date.now() - startedAt,
    hopTrace,
    abstained: notDocumented,
  });
  return result;
}
