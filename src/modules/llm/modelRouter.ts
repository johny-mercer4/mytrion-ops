/**
 * Model routing: which provider + model serves a given role. The chat loop resolves a model
 * per purpose. Internal evidence remains on OpenAI. Groq is deliberately restricted to
 * sanitized, evidence-free offline benchmark cases.
 *
 *   worker    — tool-selection + tool-iteration (OpenAI nano in the v2 policy)
 *   answer    — final user-facing answer (kept on OpenAI for instruction-following / low hallucination)
 *   reasoning — hard/ambiguous escalation
 *   embedding — vectors (OpenAI)
 */
import { env } from '../../config/env.js';
import { models, type Provider } from './openaiClient.js';

export type ModelRole = 'worker' | 'answer' | 'reasoning' | 'embedding' | 'router' | 'grader' | 'casual';

export interface ResolvedModel {
  provider: Provider;
  model: string;
}

export interface ModelPolicy extends ResolvedModel {
  role: ModelRole;
  evidenceAllowed: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  retries: number;
  fallback?: ResolvedModel;
}

export interface ResolveModelOptions {
  model?: string | undefined;
  evidenceBearing?: boolean | undefined;
  /** Groq is permitted only for sanitized offline benchmark inputs in the current policy. */
  sanitizedBenchmark?: boolean | undefined;
}

/**
 * Resolve a role to a concrete provider+model. Explicit Groq overrides are accepted only when the
 * call carries no internal evidence; evidence-bearing calls are forced to the protected OpenAI role.
 */
export function resolveModelPolicy(role: ModelRole, opts: ResolveModelOptions = {}): ModelPolicy {
  const evidenceBearing = opts.evidenceBearing ?? (role === 'answer' || role === 'reasoning');
  const protectedModel = role === 'reasoning'
    ? (models.hard ?? models.reasoning)
    : role === 'answer'
      ? (env.FF_RAG_MODEL_POLICY ? (models.grounded ?? models.default) : models.default)
      : (env.FF_RAG_MODEL_POLICY ? (models.nano ?? models.default) : models.default);
  const protectedOpenAi: ResolvedModel = {
    provider: 'openai',
    model: protectedModel,
  };

  if (opts.model) {
    const explicit: ResolvedModel = {
      provider: opts.model.includes('/') ? 'groq' : 'openai',
      model: opts.model,
    };
    const resolved = explicit.provider !== 'openai' && (evidenceBearing || !opts.sanitizedBenchmark)
      ? protectedOpenAi
      : explicit;
    return {
      role,
      ...resolved,
      evidenceAllowed: resolved.provider === 'openai',
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      retries: 2,
      ...(resolved.provider === 'openai' ? {} : { fallback: protectedOpenAi }),
    };
  }
  let resolved: ResolvedModel;
  switch (role) {
    case 'worker':
      resolved = env.FF_GROQ_ENABLED && opts.sanitizedBenchmark && !evidenceBearing
        ? { provider: 'groq', model: env.GROQ_MODEL_WORKER }
        : { provider: 'openai', model: env.FF_RAG_MODEL_POLICY ? (models.nano ?? models.default) : models.default };
      break;
    case 'reasoning':
      resolved = { provider: 'openai', model: models.hard ?? models.reasoning };
      break;
    case 'embedding':
      resolved = { provider: 'openai', model: models.embedding };
      break;
    case 'router':
    case 'grader':
    case 'casual':
      resolved = {
        provider: 'openai',
        model: env.FF_RAG_MODEL_POLICY ? (models.nano ?? models.default) : models.default,
      };
      break;
    case 'answer':
    default:
      resolved = { provider: 'openai', model: env.FF_RAG_MODEL_POLICY ? (models.grounded ?? models.default) : models.default };
      break;
  }
  if (evidenceBearing && resolved.provider !== 'openai') resolved = protectedOpenAi;
  return {
    role,
    ...resolved,
    evidenceAllowed: resolved.provider === 'openai',
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    retries: 2,
    ...(resolved.provider === 'openai' ? {} : { fallback: protectedOpenAi }),
  };
}

export function resolveModel(role: ModelRole, opts: ResolveModelOptions = {}): ResolvedModel {
  const policy = resolveModelPolicy(role, opts);
  return { provider: policy.provider, model: policy.model };
}
