/**
 * Model routing: which model serves a given role. OpenAI-only by decision.
 *
 *   worker    — tool-selection + tool-iteration (nano tier)
 *   answer    — final user-facing answer (grounded tier: instruction-following / low hallucination)
 *   reasoning — hard/ambiguous escalation (hard tier — MUST differ from answer, or it is a no-op)
 *   router / grader / casual — cheap classification (nano tier)
 *   embedding — vectors
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
}

/** The cheap tool-free tier: router / grader / casual / worker. */
function fastModel(): string {
  return env.FF_RAG_MODEL_POLICY ? (models.nano ?? models.default) : models.default;
}

/**
 * Resolve a role to a concrete provider+model. Every role resolves to OpenAI — an explicit `model`
 * override selects a different OpenAI model, never a different provider.
 *
 * This used to carry a Groq branch reachable only when a caller passed `sanitizedBenchmark`, which
 * nothing ever did; it was removed 2026-08-12 along with the Groq/GLM clients. `evidenceAllowed` is
 * retained because it is the invariant worth keeping explicit: internal evidence may only be sent to
 * a provider we have vetted, and any future provider must re-establish that before it is added here.
 */
export function resolveModelPolicy(role: ModelRole, opts: ResolveModelOptions = {}): ModelPolicy {
  let model: string;
  if (opts.model) {
    model = opts.model;
  } else {
    switch (role) {
      case 'reasoning':
        model = models.hard ?? models.reasoning;
        break;
      case 'embedding':
        model = models.embedding;
        break;
      case 'worker':
      case 'router':
      case 'grader':
      case 'casual':
        model = fastModel();
        break;
      case 'answer':
      default:
        model = env.FF_RAG_MODEL_POLICY ? (models.grounded ?? models.default) : models.default;
        break;
    }
  }
  return {
    role,
    provider: 'openai',
    model,
    evidenceAllowed: true,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    retries: 2,
  };
}

export function resolveModel(role: ModelRole, opts: ResolveModelOptions = {}): ResolvedModel {
  const policy = resolveModelPolicy(role, opts);
  return { provider: policy.provider, model: policy.model };
}
