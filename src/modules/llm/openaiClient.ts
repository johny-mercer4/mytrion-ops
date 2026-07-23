import OpenAI from 'openai';
import { env } from '../../config/env.js';

export type Provider = 'openai' | 'groq' | 'glm';

let openaiClient: OpenAI | null = null;
let groqClient: OpenAI | null = null;
let glmClient: OpenAI | null = null;

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

/**
 * Groq via its OpenAI-compatible endpoint — same `OpenAI` client, different baseURL.
 * Lazy + placeholder key, same as getOpenAI.
 */
export function getGroq(): OpenAI {
  if (!groqClient) {
    groqClient = new OpenAI({
      apiKey: env.GROQ_API_KEY || 'gsk-not-configured',
      baseURL: env.GROQ_BASE_URL,
      maxRetries: 2,
      timeout: env.OPENAI_TIMEOUT_MS,
    });
  }
  return groqClient;
}

/**
 * Zhipu AI / GLM via its OpenAI-compatible endpoint.
 * Lazy + placeholder key.
 */
export function getGLM(): OpenAI {
  if (!glmClient) {
    glmClient = new OpenAI({
      apiKey: env.GLM_API_KEY || 'glm-not-configured',
      baseURL: env.GLM_BASE_URL,
      maxRetries: 2,
      timeout: env.OPENAI_TIMEOUT_MS,
    });
  }
  return glmClient;
}

/** Resolve the client for a provider (all are OpenAI-SDK clients). */
export function getClient(provider: Provider): OpenAI {
  if (provider === 'glm') return getGLM();
  return provider === 'groq' ? getGroq() : getOpenAI();
}

/** For tests: inject a stub OpenAI client. */
export function setOpenAIClient(stub: OpenAI): void {
  openaiClient = stub;
}

/** For tests: inject a stub Groq client. */
export function setGroqClient(stub: OpenAI): void {
  groqClient = stub;
}

/** For tests: inject a stub GLM client. */
export function setGLMClient(stub: OpenAI): void {
  glmClient = stub;
}

export const models = {
  default: env.OPEN_AI_FOUR_O_MINI,
  reasoning: env.OPEN_AI_FIVE_O_MINI,
  embedding: env.OPEN_AI_EMBEDDING_SMALL,
} as const;
