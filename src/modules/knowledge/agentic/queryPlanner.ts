/**
 * Query planning + sufficiency judging for the agentic retrieval loop. One cheap model call
 * each; both degrade safely — the planner falls back to the original question, and the judge
 * falls back to "insufficient" (honest: a dead judge can't certify coverage; the loop is
 * still bounded because RAG_MAX_HOPS caps hops and empty missingQueries breaks out).
 */
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { getOpenAI, models } from '../../llm/openaiClient.js';

function plannerModel(): string {
  return env.RAG_PLANNER_MODEL || models.default;
}

/** Decompose/rewrite the question into 1–RAG_MULTIQUERY_MAX focused search queries. */
export async function planQueries(question: string): Promise<string[]> {
  try {
    const res = await getOpenAI().chat.completions.create({
      model: plannerModel(),
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Rewrite the user question into short knowledge-base search queries (different ' +
            `angles/keywords). Return JSON: {"queries": string[]} with 1-${env.RAG_MULTIQUERY_MAX} entries.`,
        },
        { role: 'user', content: question },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { queries?: unknown };
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      : [];
    return queries.length > 0 ? queries.slice(0, env.RAG_MULTIQUERY_MAX) : [question];
  } catch (err) {
    logger.warn({ err }, 'RAG query planner failed; using the original question');
    return [question];
  }
}

export interface SufficiencyVerdict {
  sufficient: boolean;
  /** Follow-up queries for the missing aspects (used as the next hop's queries). */
  missingQueries: string[];
}

/** Judge whether the retrieved passages can answer the question; if not, what's missing. */
export async function judgeSufficiency(
  question: string,
  passages: Array<{ content: string }>,
): Promise<SufficiencyVerdict> {
  try {
    const context = passages
      .slice(0, 6)
      .map((p, i) => `[${i + 1}] ${p.content.slice(0, 500)}`)
      .join('\n');
    const res = await getOpenAI().chat.completions.create({
      model: plannerModel(),
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Given a question and retrieved passages, decide if the passages contain enough ' +
            'information to answer. Return JSON: {"sufficient": boolean, "missingQueries": string[]} ' +
            '(missingQueries = up to 2 search queries for what is missing; empty when sufficient).',
        },
        { role: 'user', content: `Question: ${question}\n\nPassages:\n${context}` },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as { sufficient?: unknown; missingQueries?: unknown };
    return {
      // Strict: only an explicit true counts. A missing/garbled field must not silently
      // certify coverage — that bias caused under-retrieval on judge hiccups.
      sufficient: parsed.sufficient === true,
      missingQueries: Array.isArray(parsed.missingQueries)
        ? parsed.missingQueries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 2)
        : [],
    };
  } catch (err) {
    logger.warn({ err }, 'RAG sufficiency judge failed; treating passages as insufficient');
    return { sufficient: false, missingQueries: [] };
  }
}
