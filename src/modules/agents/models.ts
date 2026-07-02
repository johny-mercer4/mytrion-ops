/**
 * Model resolution for the multi-agent stack — the single seam a future provider plugs into
 * (per the OpenAI-only decision, everything resolves to ChatOpenAI today; Groq stays dormant).
 * A placeholder key keeps construction from throwing at import (real calls 401 instead).
 */
import { ChatOpenAI } from '@langchain/openai';
import { env } from '../../config/env.js';
import { models } from '../llm/openaiClient.js';
import type { AgentManifest } from './types.js';

function makeChatModel(model: string): ChatOpenAI {
  return new ChatOpenAI({
    model,
    apiKey: env.OPENAI_API_KEY || 'sk-not-configured',
    temperature: 0,
    maxRetries: 2,
  });
}

/** The parent orchestrator's model: ORCHESTRATOR_MODEL → DEEP_AGENTS_MODEL → default. */
export function resolveOrchestratorModel(): ChatOpenAI {
  return makeChatModel(env.ORCHESTRATOR_MODEL || env.DEEP_AGENTS_MODEL || models.default);
}

/** A child agent's model: manifest override → AGENT_CHILD_MODEL → default. */
export function resolveAgentModel(manifest: AgentManifest): ChatOpenAI {
  return makeChatModel(manifest.model || env.AGENT_CHILD_MODEL || models.default);
}

/** The model id a child resolves to (for agent_runs/cost bookkeeping). */
export function resolveAgentModelId(manifest?: AgentManifest): string {
  if (manifest) return manifest.model || env.AGENT_CHILD_MODEL || models.default;
  return env.ORCHESTRATOR_MODEL || env.DEEP_AGENTS_MODEL || models.default;
}
