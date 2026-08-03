import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { config } from './config.js';
import { incrementCounter } from './metrics.js';
import { getOpenAIClient } from './openaiClient.js';
import { approximateTokens, executeOpenAIRequest } from './openaiResilience.js';
import { GatewayOverloadError, isGatewayOverloadError } from './overload.js';
import {
  SERVICE_CATALOG,
  isServiceEnabled,
  runtimeServiceAvailability,
  serviceForTool,
  type ServiceAvailability,
  type ServiceId,
} from './serviceRegistry.js';
import { filterToolsForRole, isToolAllowedForRole, type GatewayRole } from './skillRegistry.js';
import type { ToolManifest } from './toolRuntime.js';

const RouteDecisionSchema = z.object({
  engage: z.boolean(),
  kind: z.enum([
    'support',
    'greeting',
    'capability',
    'continuation',
    'chatter',
    'general',
    'out_of_scope',
  ]),
  completeness: z.enum(['complete', 'fragment', 'needs_details']),
  language: z.string().min(2).max(20),
  serviceIds: z.array(z.string()).max(6),
  toolNames: z.array(z.string()).max(12),
  requiredToolNames: z.array(z.string()).max(5),
  handoff: z.enum(['none', 'sales', 'customer_service']),
  confidence: z.number().min(0).max(1),
});

type RawRouteDecision = z.infer<typeof RouteDecisionSchema>;

export interface AiRouteDecision extends RawRouteDecision {
  trustedConfirmation: boolean;
  source: 'openai' | 'safe-fallback' | 'overload-fallback';
  routerUsage?: RouterUsage;
}

export interface RouterUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  openaiCalls: number;
}

export interface RouterMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClassifySupportTurnInput {
  role: GatewayRole;
  direct: boolean;
  conversationActive: boolean;
  trustedConfirmation: boolean;
  currentText: string;
  context: readonly RouterMessage[];
  manifests: readonly ToolManifest[];
  availability?: ServiceAvailability;
  deadlineAt?: number;
}

export interface AiToolPlan {
  tools: ToolManifest[];
  requiredSequence: string[];
  unavailableService?: ServiceId;
  roleDeniedTool?: string;
}

const SYSTEM_PROMPT = `You are the semantic ingress and tool router for an Octane customer-support bot in a busy Telegram company group.

Return only the supplied structured schema.
- Every message in this router comes from a backend-authenticated Octane user. Always engage and answer; never return silent for social chatter or an out-of-scope question.
- Use high recall for customer operations: if the text plausibly asks a question, requests an action, reports a problem, supplies requested details, or seeks information related to any catalog service, engage even without a bot tag or the word "team".
- Use "general" for normal conversation that can be answered without Octane tools. Use "out_of_scope" when Octane cannot resolve the request directly.
- A direct @mention, reply to the bot, or trusted button tap must engage.
- An active bot conversation helps resolve follow-ups, but the newest complete request replaces stale context.
- Understand any human language, slang, misspellings, and a request split across several messages.
- Use the recent context to resolve fragments and follow-ups, but the newest complete request replaces an older unresolved request.
- "greeting" means only a greeting addressed to support. "capability" means asking what the bot can do.
- Select serviceIds and toolNames only from the runtime catalog below. Never invent names.
- serviceIds describe the user's requested business capability; do not select infrastructure-only core or memory services as user intent.
- Select live-data tools for factual account/card/report requests and the knowledge tool for Octane policy/how-to questions.
- requiredToolNames are tools that must run before an answer can be reliable. Keep the set minimal.
- Before a server-bound confirmation, do not select a tool marked trusted_button; select the relevant read prerequisite and telegram_buttons with the exact target tool and arguments. Typed yes is never trusted. Confirmed actions bypass this router and execute only their stored arguments.
- telegram_buttons is only for a complete supported write confirmation. Never select it for information gathering, urgency choices, generic handoff, navigation, or a callback/call request.
- Disabled and role-forbidden entries may be identified so the server can explain denial, but never claim they are authorized.
- Set handoff=sales for product, pricing, onboarding, account-growth, or commercial questions that need the assigned sales agent.
- Set handoff=customer_service for unresolved operational support, exceptions, complaints, or requests that need a human support ticket. Use none when you can answer directly.
- A model routing decision never grants permission. Server RBAC, service switches, validation, audit, and trusted write confirmation remain authoritative.`;

const serviceIds = Object.keys(SERVICE_CATALOG) as ServiceId[];

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function routerCatalog(
  manifests: readonly ToolManifest[],
  role: GatewayRole,
  availability: ServiceAvailability,
): object {
  return {
    services: serviceIds.map((id) => ({
      id,
      label: SERVICE_CATALOG[id].label,
      description: SERVICE_CATALOG[id].description,
      enabled: isServiceEnabled(id, availability),
    })),
    tools: manifests.map((manifest) => ({
      name: manifest.name,
      description: manifest.description.slice(0, 500),
      serviceId: serviceForTool(manifest.name),
      enabled:
        serviceForTool(manifest.name) === null ||
        isServiceEnabled(serviceForTool(manifest.name) as ServiceId, availability),
      roleAllowed: isToolAllowedForRole(manifest.name, role),
      riskClass: manifest.riskClass,
      confirmationMode: manifest.confirmationMode ?? 'none',
      requirementMode: manifest.requirementMode ?? 'must',
    })),
  };
}

export function sanitizeRouteDecision(
  raw: RawRouteDecision,
  input: ClassifySupportTurnInput,
): AiRouteDecision {
  const knownServices = new Set(serviceIds);
  const knownTools = new Set(input.manifests.map((manifest) => manifest.name));
  const toolNames = unique(raw.toolNames).filter((name) => knownTools.has(name));
  const requiredToolNames = unique(raw.requiredToolNames).filter(
    (name) => knownTools.has(name) && toolNames.includes(name),
  );
  return {
    ...raw,
    engage: input.role !== 'guest',
    serviceIds: unique(raw.serviceIds).filter((id) => knownServices.has(id as ServiceId)),
    toolNames,
    requiredToolNames,
    trustedConfirmation: input.trustedConfirmation,
    source: 'openai',
    routerUsage: emptyRouterUsage(),
  };
}

function emptyRouterUsage(): RouterUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    openaiCalls: 0,
  };
}

function safeFallback(
  input: ClassifySupportTurnInput,
  source: 'safe-fallback' | 'overload-fallback' = 'safe-fallback',
): AiRouteDecision {
  const engage = input.role !== 'guest';
  const safeTools = input.manifests
    .filter(
      (manifest) =>
        manifest.riskClass === 'read' &&
        isToolAllowedForRole(manifest.name, input.role) &&
        ['octane_kb_search', 'octane_whoami'].includes(manifest.name),
    )
    .map((manifest) => manifest.name);
  return {
    engage,
    kind: input.conversationActive ? 'continuation' : engage ? 'support' : 'chatter',
    completeness: 'complete',
    language: 'und',
    serviceIds: [],
    toolNames: engage ? safeTools : [],
    requiredToolNames: [],
    handoff: engage ? 'customer_service' : 'none',
    confidence: 0,
    trustedConfirmation: input.trustedConfirmation,
    source,
    routerUsage: emptyRouterUsage(),
  };
}

let activeRouters = 0;
interface RouterWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}
const routerWaiters: RouterWaiter[] = [];

async function acquireRouterSlot(deadlineAt?: number): Promise<void> {
  if (activeRouters < config.openaiRouterMaxConcurrent) {
    activeRouters += 1;
    return;
  }
  if (routerWaiters.length >= config.openaiRouterQueueMax) {
    incrementCounter('openai_overload_rejected_total');
    throw new GatewayOverloadError('capacity', 'OpenAI router queue capacity exceeded');
  }
  const waitMs = deadlineAt === undefined ? undefined : deadlineAt - Date.now();
  if (waitMs !== undefined && waitMs <= 0) {
    incrementCounter('stale_request_total');
    throw new GatewayOverloadError('stale', 'OpenAI router request became stale');
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: RouterWaiter = { resolve, reject, timer: null };
    if (waitMs !== undefined) {
      waiter.timer = setTimeout(() => {
        const index = routerWaiters.indexOf(waiter);
        if (index >= 0) routerWaiters.splice(index, 1);
        incrementCounter('stale_request_total');
        reject(new GatewayOverloadError('stale', 'OpenAI router queue wait exceeded'));
      }, waitMs);
    }
    routerWaiters.push(waiter);
  });
}

function releaseRouterSlot(): void {
  const waiter = routerWaiters.shift();
  if (waiter) {
    // Transfer the existing slot directly; a new caller cannot slip in before
    // the waiter's promise resumes and temporarily exceed the concurrency cap.
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.resolve();
    return;
  }
  activeRouters = Math.max(0, activeRouters - 1);
}

export async function classifySupportTurn(
  input: ClassifySupportTurnInput,
): Promise<AiRouteDecision> {
  let acquired = false;
  try {
    await acquireRouterSlot(input.deadlineAt);
    acquired = true;
    incrementCounter('ai_router_calls_total');
    const availability = input.availability ?? runtimeServiceAvailability;
    const requestInput = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: JSON.stringify({
          transport: {
            direct: input.direct,
            conversationActive: input.conversationActive,
            trustedConfirmation: input.trustedConfirmation,
          },
          verifiedRole: input.role,
          currentText: input.currentText.slice(0, 5_000),
          recentContext: input.context.slice(-12),
          catalog: routerCatalog(input.manifests, input.role, availability),
        }),
      },
    ];
    const estimatedTokens =
      approximateTokens(requestInput.map((item) => item.content).join('\n')) +
      config.openaiRouterMaxOutputTokens;
    const response = await executeOpenAIRequest({
      estimatedTokens,
      deadlineAt: input.deadlineAt,
      operation: () =>
        getOpenAIClient().responses.parse({
          model: config.openaiRouterModel,
          input: requestInput,
          text: {
            format: zodTextFormat(RouteDecisionSchema, 'octane_support_route'),
          },
          reasoning: { effort: 'none' },
          max_output_tokens: config.openaiRouterMaxOutputTokens,
          store: false,
        }),
      usageTokens: (result) =>
        (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
    });
    if (!response.output_parsed) {
      throw new Error('OpenAI router returned no parsed decision');
    }
    const decision = sanitizeRouteDecision(response.output_parsed, input);
    decision.routerUsage = response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadInputTokens: response.usage.input_tokens_details.cached_tokens,
          cacheWriteInputTokens: response.usage.input_tokens_details.cache_write_tokens,
          openaiCalls: 1,
        }
      : { ...emptyRouterUsage(), openaiCalls: 1 };
    incrementCounter('ai_router_input_tokens_total', decision.routerUsage.inputTokens);
    incrementCounter('ai_router_output_tokens_total', decision.routerUsage.outputTokens);
    incrementCounter('ai_router_cached_tokens_total', decision.routerUsage.cacheReadInputTokens);
    incrementCounter(decision.engage ? 'ai_router_engaged_total' : 'ai_router_silent_total');
    return decision;
  } catch (error) {
    if (isGatewayOverloadError(error)) {
      if (error.kind === 'provider_429') {
        incrementCounter('ai_router_429_total');
      }
      return safeFallback(input, 'overload-fallback');
    }
    const status = error instanceof OpenAI.APIError ? error.status : undefined;
    incrementCounter(status === 429 ? 'ai_router_429_total' : 'ai_router_error_total');
    const fallback = safeFallback(input);
    incrementCounter(fallback.engage ? 'ai_router_engaged_total' : 'ai_router_silent_total');
    return fallback;
  } finally {
    if (acquired) releaseRouterSlot();
  }
}

export function selectAiToolPlan(
  manifests: readonly ToolManifest[],
  decision: AiRouteDecision,
  role: GatewayRole,
  availability: ServiceAvailability = runtimeServiceAvailability,
): AiToolPlan {
  const requestedServices = decision.serviceIds.filter((serviceId): serviceId is ServiceId =>
    serviceIds.includes(serviceId as ServiceId),
  );
  const unavailableService = requestedServices.find(
    (serviceId) => !isServiceEnabled(serviceId, availability),
  );
  if (unavailableService) {
    return { tools: [], requiredSequence: [], unavailableService };
  }

  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const denied = decision.toolNames.find(
    (name) => byName.has(name) && !isToolAllowedForRole(name, role),
  );
  const requested = unique([
    ...decision.toolNames,
    ...decision.requiredToolNames,
    ...(decision.handoff === 'none' ? [] : ['octane_whoami']),
  ])
    .map((name) => byName.get(name))
    .filter((manifest): manifest is ToolManifest => manifest !== undefined)
    .filter((manifest) => {
      const service = serviceForTool(manifest.name);
      return service === null || isServiceEnabled(service, availability);
    })
    .filter(
      (manifest) => manifest.confirmationMode !== 'trusted_button' || decision.trustedConfirmation,
    );

  let tools = filterToolsForRole(requested, role);
  const noAuthorizedRequestedTool = tools.length === 0;
  if (
    !tools.length &&
    ['support', 'general', 'out_of_scope', 'continuation'].includes(decision.kind)
  ) {
    const safeFallbackNames = new Set(['octane_kb_search', 'octane_whoami']);
    tools = filterToolsForRole(
      manifests.filter(
        (manifest) => safeFallbackNames.has(manifest.name) && manifest.riskClass === 'read',
      ),
      role,
    );
  }
  const allowed = new Set(tools.map((manifest) => manifest.name));
  const requiredSequence = unique([
    ...(decision.handoff === 'none' ? [] : ['octane_whoami']),
    ...decision.requiredToolNames,
  ]).filter((name) => allowed.has(name) && byName.get(name)?.requirementMode !== 'best_effort');
  return {
    tools,
    requiredSequence,
    ...(denied && noAuthorizedRequestedTool ? { roleDeniedTool: denied } : {}),
  };
}

export function greetingText(language: string): string {
  const locale = language.toLocaleLowerCase();
  if (locale.startsWith('ru')) return 'Привет! Чем могу помочь?';
  if (locale.startsWith('es')) return '¡Hola! ¿En qué puedo ayudarle?';
  if (locale.startsWith('en')) return 'Hi! How can I help?';
  return 'Salom! Qanday yordam bera olaman?';
}
