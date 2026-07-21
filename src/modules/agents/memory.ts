/**
 * Long-term agent memory (FF_AGENT_MEMORY): end-of-run distillation of ≤3 durable facts and
 * query-time recall. Memory is model-generated text — recall always renders it inside an
 * UNTRUSTED block and it never counts as a knowledge citation.
 */
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { memoryRepo } from '../../repos/memoryRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { embedQuery, embedTexts } from '../knowledge/embedder.js';
import { getOpenAI, models } from '../llm/openaiClient.js';
import { wrapUntrusted } from '../security/untrusted.js';

/** Distill durable facts from a finished turn and store them. Best-effort — never throws. */
export async function distillMemories(
  ctx: TenantContext,
  agentKey: string,
  question: string,
  answer: string,
): Promise<void> {
  if (!env.FF_AGENT_MEMORY) return;
  try {
    const res = await getOpenAI().chat.completions.create({
      model: env.RAG_PLANNER_MODEL || models.default,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Extract up to 3 DURABLE facts or core state entities worth remembering for future conversations ' +
            '(stable business facts, standing user preferences, recurring entities like explicit carriers or accounts mentioned). ' +
            'CRITICAL: You must extract explicit names and IDs of entities discussed so they can be recalled via exact semantic match (e.g., "carrier from yesterday" -> "Carrier Acme Corp ID 1234"). ' +
            'Skip transient details (one-off numbers, dates that will stale). Return JSON: ' +
            '{"facts": [{"content": string, "kind": "fact"|"preference"}]} — empty when nothing durable.',
        },
        { role: 'user', content: `Q: ${question.slice(0, 2000)}\n\nA: ${answer.slice(0, 4000)}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as {
      facts?: Array<{ content?: unknown; kind?: unknown }>;
    };
    const facts = (parsed.facts ?? [])
      .filter((f): f is { content: string; kind?: string } => typeof f.content === 'string' && f.content.trim().length > 0)
      .slice(0, 3);
    if (facts.length === 0) return;
    const embeddings = await embedTexts(facts.map((f) => f.content));
    const department = ctx.departments[0] ?? null;
    for (const [i, fact] of facts.entries()) {
      const embedding = embeddings[i];
      if (!embedding) continue;
      await memoryRepo.insert(ctx, {
        agentKey,
        departmentAccess: department,
        userId: ctx.userId,
        kind: fact.kind === 'preference' ? 'preference' : 'fact',
        content: fact.content.slice(0, 2000),
        embedding,
      });
    }
    await memoryRepo.evictBeyondCap(ctx, agentKey, department, env.AGENT_MEMORY_MAX_PER_KEY);
  } catch (err) {
    logger.warn({ err, agentKey }, 'memory distillation failed (ignored)');
  }
}

/** Top-k relevant memories as an UNTRUSTED block, or '' when none/disabled. Never throws. */
export async function recallMemories(
  ctx: TenantContext,
  agentKey: string,
  query: string,
  k = 3,
): Promise<string> {
  if (!env.FF_AGENT_MEMORY) return '';
  try {
    const embedding = await embedQuery(query);
    const rows = await memoryRepo.search(ctx, agentKey, embedding, k);
    if (rows.length === 0) return '';
    const body = rows.map((r) => `- (${r.kind}) ${r.content}`).join('\n');
    return `\n\nPossibly relevant agent memory (unverified, do NOT cite as knowledge):\n${wrapUntrusted('memory', body)}`;
  } catch (err) {
    logger.warn({ err, agentKey }, 'memory recall failed (ignored)');
    return '';
  }
}
