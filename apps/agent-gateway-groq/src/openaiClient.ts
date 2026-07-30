import OpenAI from 'openai';
import { config } from './config.js';

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }
  client ??= new OpenAI({
    apiKey: config.openaiApiKey,
    maxRetries: 2,
    timeout: config.openaiRequestTimeoutMs,
  });
  return client;
}

/** Test seam for model-provider tests. */
export function setOpenAIClient(next: OpenAI | null): void {
  client = next;
}
