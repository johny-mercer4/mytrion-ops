/**
 * Optional listwise LLM rerank of fused candidates (FF_RAG_RERANK). The model sees numbered
 * chunk texts only and returns an ordering — never filter parameters, so it cannot affect
 * scope. Degrades to the fused order on any failure.
 */
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { getOpenAI, models } from '../../llm/openaiClient.js';
import type { RetrievedPassage } from './types.js';

export async function rerankPassages(
  question: string,
  candidates: RetrievedPassage[],
  k: number,
): Promise<RetrievedPassage[]> {
  if (!env.FF_RAG_RERANK || candidates.length <= k) return candidates.slice(0, k);
  try {
    const list = candidates
      .slice(0, 20)
      .map((p, i) => `[${i}] ${p.content.slice(0, 400)}`)
      .join('\n');
    const res = await getOpenAI().chat.completions.create({
      model: env.RAG_PLANNER_MODEL || models.default,
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `Rank the numbered passages by relevance to the question. Return JSON: ` +
            `{"order": number[]} with the ${k} most relevant indexes, best first.`,
        },
        { role: 'user', content: `Question: ${question}\n\nPassages:\n${list}` },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '') as { order?: unknown };
    if (!Array.isArray(parsed.order)) return candidates.slice(0, k);
    const picked = parsed.order
      .filter((i): i is number => typeof i === 'number' && Number.isInteger(i))
      .map((i) => candidates[i])
      .filter((p): p is RetrievedPassage => p !== undefined);
    const rest = candidates.filter((p) => !picked.includes(p));
    return [...picked, ...rest].slice(0, k);
  } catch (err) {
    logger.warn({ err }, 'RAG rerank failed; keeping fused order');
    return candidates.slice(0, k);
  }
}
