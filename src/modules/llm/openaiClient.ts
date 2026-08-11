import OpenAI from 'openai';
import { env } from '../../config/env.js';

/**
 * OpenAI is the only provider. Groq and Zhipu/GLM clients used to live here and were removed
 * 2026-08-12: neither was reachable. `modelRouter` never emitted `'glm'` at all, and every Groq
 * path was gated on a `sanitizedBenchmark` option that nothing in `src/` or `scripts/` ever passed —
 * so `FF_GROQ_ENABLED=1` and two live API keys bought exactly nothing.
 *
 * Kept as a one-member union rather than deleted outright: it is the seam a future provider plugs
 * into, and it keeps `llm_calls.provider` telemetry honest about what served a call.
 */
export type Provider = 'openai';

let openaiClient: OpenAI | null = null;

/**
 * Lazily construct a single OpenAI client. Lazy so importing this module never
 * requires a key (tests, tooling). A placeholder key is used when none is set so
 * construction never throws; real calls then fail with 401 rather than at import.
 */
export function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY || 'sk-not-configured',
      maxRetries: 2,
      timeout: env.OPENAI_TIMEOUT_MS,
    });
  }
  return openaiClient;
}

/** Resolve the client for a provider. One provider today; the signature is the extension seam. */
export function getClient(_provider: Provider): OpenAI {
  return getOpenAI();
}

/** For tests: inject a stub OpenAI client. */
export function setOpenAIClient(stub: OpenAI): void {
  openaiClient = stub;
}

export const models = {
  /**
   * Cheap utility tier: tool-free helper calls (memory distillation, skill distillation, file Q&A,
   * rerank) and the fallback every role resolves to when FF_RAG_MODEL_POLICY is off.
   *
   * Was `gpt-4o-mini` — retired 2026-08-11. It is a legacy non-reasoning model and the one model
   * whose cached-input discount is 50% rather than the 90% the 5.x family gets, so it was the most
   * expensive possible choice for the calls that repeat a stable prefix most often.
   * Callers must build params via `completionParams()`; a reasoning-tier id rejects
   * `temperature`/`max_tokens`.
   */
  default: env.OPEN_AI_FIVE_O_NANO,
  nano: env.OPEN_AI_FIVE_O_NANO,
  grounded: env.OPEN_AI_FIVE_O_MINI,
  reasoning: env.OPEN_AI_FIVE_O_MINI,
  /** Escalation only. Deliberately a different, stronger model than `grounded`. */
  hard: env.OPEN_AI_HARD_MODEL,
  embedding: env.OPEN_AI_EMBEDDING_SMALL,
} as const;
