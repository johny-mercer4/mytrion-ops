/**
 * Query planning + CRAG grading for the agentic retrieval loop. One cheap model call
 * each; both degrade safely — the planner falls back to the original question, and the judge
 * falls back to Incorrect (honest: a dead judge can't certify coverage; the loop is
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

/** Classic Corrective-RAG retrieval grades. */
export type CragGrade = 'Correct' | 'Ambiguous' | 'Incorrect';

export interface SufficiencyVerdict {
  /** True only when grade === Correct (backward-compatible). */
  sufficient: boolean;
  grade: CragGrade;
  /** Follow-up queries for Ambiguous (used as the next hop's queries). */
  missingQueries: string[];
}

function normalizeGrade(raw: unknown, sufficientFlag: unknown): CragGrade {
  if (raw === 'Correct' || raw === 'Ambiguous' || raw === 'Incorrect') return raw;
  // Legacy models that only return sufficient boolean.
  if (sufficientFlag === true) return 'Correct';
  if (sufficientFlag === false) return 'Ambiguous';
  return 'Incorrect';
}

/** CRAG grade: whether retrieved passages answer the question. */
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
      max_tokens: 220,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Grade retrieved passages for answering the question (Corrective RAG). Return JSON: ' +
            '{"grade": "Correct"|"Ambiguous"|"Incorrect", "sufficient": boolean, "missingQueries": string[]}. ' +
            'Correct = passages fully answer; Ambiguous = partial (provide up to 2 missingQueries); ' +
            'Incorrect = passages are irrelevant/wrong (missingQueries empty). ' +
            'sufficient must be true ONLY when grade is Correct.',
        },
        { role: 'user', content: `Question: ${question}\n\nPassages:\n${context}` },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as {
      sufficient?: unknown;
      grade?: unknown;
      missingQueries?: unknown;
    };
    const grade = normalizeGrade(parsed.grade, parsed.sufficient);
    return {
      grade,
      sufficient: grade === 'Correct',
      missingQueries:
        grade === 'Ambiguous' && Array.isArray(parsed.missingQueries)
          ? parsed.missingQueries
              .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
              .slice(0, 2)
          : [],
    };
  } catch (err) {
    logger.warn({ err }, 'RAG sufficiency judge failed; treating passages as Incorrect');
    return { sufficient: false, grade: 'Incorrect', missingQueries: [] };
  }
}
