/**
 * Model resolution for the multi-agent stack — the single seam a future provider plugs into
 * (per the OpenAI-only decision, everything resolves to ChatOpenAI today; Groq stays dormant).
 * A placeholder key keeps construction from throwing at import (real calls 401 instead).
 */
import { ChatOpenAI } from '@langchain/openai';
import { env } from '../../config/env.js';
import { chatOpenAIFields } from '../llm/modelParams.js';
import { models } from '../llm/openaiClient.js';
import type { AgentManifest } from './types.js';

function makeChatModel(model: string): ChatOpenAI {
  const isGLM = model.startsWith('glm-') || (env.GLM_API_KEY && model === env.GLM_MODEL_WORKER);

  if (isGLM) {
    return new ChatOpenAI({
      model,
      apiKey: env.GLM_API_KEY || 'glm-not-configured',
      configuration: {
        baseURL: env.GLM_BASE_URL,
      },
      maxRetries: 2,
      timeout: env.AGENT_MODEL_TIMEOUT_MS,
      ...chatOpenAIFields(model, env.AGENT_MAX_OUTPUT_TOKENS),
    });
  }

  // chatOpenAIFields: reasoning-tier models (Sales' gpt-5.4-mini) reject temperature and
  // take maxCompletionTokens; classic models get temperature:0 + maxTokens.
  return new ChatOpenAI({
    model,
    apiKey: env.OPENAI_API_KEY || 'sk-not-configured',
    maxRetries: 2,
    timeout: env.AGENT_MODEL_TIMEOUT_MS,
    ...chatOpenAIFields(model, env.AGENT_MAX_OUTPUT_TOKENS),
  });
}

/** The parent orchestrator's model: ORCHESTRATOR_MODEL → DEEP_AGENTS_MODEL → default. */
export function resolveOrchestratorModel(): ChatOpenAI {
  const defaultModel = env.GLM_API_KEY ? env.GLM_MODEL_WORKER : models.default;
  return makeChatModel(env.ORCHESTRATOR_MODEL || env.DEEP_AGENTS_MODEL || defaultModel);
}

/** A child agent's model: manifest override → AGENT_CHILD_MODEL → default. */
export function resolveAgentModel(manifest: AgentManifest): ChatOpenAI {
  const defaultModel = env.GLM_API_KEY ? env.GLM_MODEL_WORKER : models.default;
  return makeChatModel(manifest.model || env.AGENT_CHILD_MODEL || defaultModel);
}

/** The model id a child resolves to (for agent_runs/cost bookkeeping). */
export function resolveAgentModelId(manifest?: AgentManifest): string {
  const defaultModel = env.GLM_API_KEY ? env.GLM_MODEL_WORKER : models.default;
  if (manifest) return manifest.model || env.AGENT_CHILD_MODEL || defaultModel;
  return env.ORCHESTRATOR_MODEL || env.DEEP_AGENTS_MODEL || defaultModel;
}
