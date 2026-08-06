/**
 * Model resolution for the multi-agent stack — the single seam a future provider plugs into
 * (per the OpenAI-only decision, everything resolves to ChatOpenAI today; Groq stays dormant).
 * A placeholder key keeps construction from throwing at import (real calls 401 instead).
 */
import { ChatOpenAI } from '@langchain/openai';
import { env } from '../../config/env.js';
import { chatOpenAIFields } from '../llm/modelParams.js';
import { resolveModelPolicy, type ModelPolicy, type ModelRole } from '../llm/modelRouter.js';
import type { AgentManifest } from './types.js';

function makeChatModel(policy: ModelPolicy): ChatOpenAI {
  const { model } = policy;
  const isGLM = policy.provider === 'glm';

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
export function resolveOrchestratorModel(role: Extract<ModelRole, 'answer' | 'casual'> = 'answer'): ChatOpenAI {
  const override = env.ORCHESTRATOR_MODEL || env.DEEP_AGENTS_MODEL || undefined;
  return makeChatModel(resolveModelPolicy(role, {
    evidenceBearing: role === 'answer',
    ...(override ? { model: override } : {}),
  }));
}

/** A child agent's model: manifest override → AGENT_CHILD_MODEL → default. */
export function resolveAgentModel(manifest: AgentManifest): ChatOpenAI {
  const override = manifest.model || env.AGENT_CHILD_MODEL || undefined;
  return makeChatModel(resolveModelPolicy('answer', {
    evidenceBearing: true,
    ...(override ? { model: override } : {}),
  }));
}

/** The model id a child resolves to (for agent_runs/cost bookkeeping). */
export function resolveAgentModelId(
  manifest?: AgentManifest,
  orchestratorRole: Extract<ModelRole, 'answer' | 'casual'> = 'answer',
): string {
  const override = manifest
    ? manifest.model || env.AGENT_CHILD_MODEL || undefined
    : env.ORCHESTRATOR_MODEL || env.DEEP_AGENTS_MODEL || undefined;
  const role = manifest ? 'answer' : orchestratorRole;
  return resolveModelPolicy(role, {
    evidenceBearing: role === 'answer',
    ...(override ? { model: override } : {}),
  }).model;
}
