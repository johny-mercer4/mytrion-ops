/**
 * The chat model the DeepAgents orchestrator + subagents run on. Reuses the OpenAI key the rest of
 * the backend uses (no new provider). DEEP_AGENTS_MODEL overrides; empty falls back to the default
 * chat model. A placeholder key keeps construction from throwing at import (real calls 401 instead).
 */
import { ChatOpenAI } from '@langchain/openai';
import { env } from '../../config/env.js';
import { models } from '../llm/openaiClient.js';

export function makeChatModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: env.DEEP_AGENTS_MODEL || models.default,
    apiKey: env.OPENAI_API_KEY || 'sk-not-configured',
    temperature: 0,
    maxRetries: 2,
  });
}
