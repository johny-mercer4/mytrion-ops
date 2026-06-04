import OpenAI from 'openai';
import { env } from '../../config/env.js';

let client: OpenAI | null = null;

/**
 * Lazily construct a single OpenAI client. Lazy so importing this module never
 * requires a key (tests, tooling). A placeholder key is used when none is set so
 * construction never throws; real calls then fail with 401 rather than at import.
 */
export function getOpenAI(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY || 'sk-not-configured', maxRetries: 2 });
  }
  return client;
}

/** For tests: inject a stub client implementing the bits we use. */
export function setOpenAIClient(stub: OpenAI): void {
  client = stub;
}

export const models = {
  default: env.OPEN_AI_FOUR_O_MINI,
  reasoning: env.OPEN_AI_FIVE_O_MINI,
  embedding: env.OPEN_AI_EMBEDDING_SMALL,
} as const;
