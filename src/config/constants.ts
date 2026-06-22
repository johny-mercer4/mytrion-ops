/** App-wide constants. No environment lookups here — see config/env.ts for those. */

export const APP_NAME = 'octane-assistant';
export const API_PREFIX = '/v1';

/** Internal users all live under this tenant id. Partners get their own tenant id. */
export const DEFAULT_TENANT_ID = 'octane';

/** pgvector embedding width for text-embedding-3-small. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Safety bound on the chat tool-calling loop. */
export const MAX_TOOL_ITERATIONS = 6;

/** How many prior turns to load into the prompt by default. */
export const DEFAULT_HISTORY_TURNS = 20;

/** Recursive character splitter defaults. */
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;

export const WILDCARD_SCOPE = '*';

export const TOKEN_TYPE_ACCESS = 'access';
export const TOKEN_TYPE_REFRESH = 'refresh';

/** kNN retrieval defaults. */
export const DEFAULT_RETRIEVAL_K = 6;
export const MAX_RETRIEVAL_K = 25;

/**
 * OpenAI pricing in USD per 1,000,000 tokens. Used by costTracker for per-tenant
 * rollups. Update when OpenAI changes prices. Embedding models have no output cost.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10.0 },
  // TODO: confirm gpt-5.4-mini pricing — placeholder; cost rollup is for visibility only,
  // and unknown models already fall back to 0 in costTracker.
  'gpt-5.4-mini': { input: 0.25, output: 2.0 },
  'gpt-5.4-mini-2026-03-17': { input: 0.25, output: 2.0 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  // Groq (USD per 1M tokens) — gpt-oss worker models. Confirm vs groq.com/pricing.
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
};
