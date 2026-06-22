/**
 * Model routing: which provider + model serves a given role. The chat loop resolves a model
 * per turn; when Groq is disabled (FF_GROQ_ENABLED off) every role resolves to an OpenAI model,
 * so behavior is identical to the all-OpenAI baseline.
 *
 *   worker    — tool-selection + tool-iteration + simple turns (fast/cheap → Groq gpt-oss when on)
 *   answer    — final user-facing answer (kept on OpenAI for instruction-following / low hallucination)
 *   reasoning — hard/ambiguous escalation
 *   embedding — vectors (OpenAI)
 */
import { env } from '../../config/env.js';
import { models, type Provider } from './openaiClient.js';

export type ModelRole = 'worker' | 'answer' | 'reasoning' | 'embedding';

export interface ResolvedModel {
  provider: Provider;
  model: string;
}

/**
 * Resolve a role to a concrete provider+model. An explicit `opts.model` override wins; a model id
 * containing '/' (e.g. `openai/gpt-oss-120b`) is treated as a Groq model, else OpenAI.
 */
export function resolveModel(role: ModelRole, opts: { model?: string | undefined } = {}): ResolvedModel {
  if (opts.model) {
    return { provider: opts.model.includes('/') ? 'groq' : 'openai', model: opts.model };
  }
  switch (role) {
    case 'worker':
      return env.FF_GROQ_ENABLED
        ? { provider: 'groq', model: env.GROQ_MODEL_WORKER }
        : { provider: 'openai', model: models.default };
    case 'reasoning':
      return { provider: 'openai', model: models.reasoning };
    case 'embedding':
      return { provider: 'openai', model: models.embedding };
    case 'answer':
    default:
      return { provider: 'openai', model: models.default };
  }
}
