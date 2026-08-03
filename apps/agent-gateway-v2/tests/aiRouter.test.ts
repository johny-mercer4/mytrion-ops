import { describe, expect, it } from 'vitest';
import {
  sanitizeRouteDecision,
  selectAiToolPlan,
  type AiRouteDecision,
  type ClassifySupportTurnInput,
} from '../src/aiRouter.js';
import { parseServiceFlags } from '../src/serviceRegistry.js';
import type { GatewayRole } from '../src/skillRegistry.js';
import type { ToolManifest } from '../src/toolRuntime.js';

function manifest(
  name: string,
  riskClass: 'read' | 'write' = 'read',
  confirmationMode?: 'trusted_button',
  requirementMode?: 'must' | 'best_effort',
): ToolManifest {
  return {
    name,
    description: `Runtime description for ${name}`,
    parameters: { type: 'object' },
    riskClass,
    ...(confirmationMode ? { confirmationMode } : {}),
    ...(requirementMode ? { requirementMode } : {}),
    async execute() {
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
}

const manifests = [
  manifest('octane_whoami'),
  manifest('octane_kb_search'),
  manifest('octane_card_status'),
  manifest('octane_card_action', 'write', 'trusted_button'),
  manifest('octane_money_code_quote'),
  manifest('octane_money_code', 'write', 'trusted_button'),
  manifest('telegram_buttons', 'write'),
  manifest('telegram_progress', 'write', undefined, 'best_effort'),
];

function raw(overrides: Partial<AiRouteDecision> = {}): AiRouteDecision {
  return {
    engage: true,
    kind: 'support',
    completeness: 'complete',
    language: 'uz',
    serviceIds: ['cards'],
    toolNames: ['octane_card_status'],
    requiredToolNames: ['octane_card_status'],
    handoff: 'none',
    confidence: 0.95,
    trustedConfirmation: false,
    source: 'openai',
    ...overrides,
  };
}

function input(
  role: GatewayRole = 'owner',
  overrides: Partial<ClassifySupportTurnInput> = {},
): ClassifySupportTurnInput {
  return {
    role,
    direct: false,
    conversationActive: false,
    trustedConfirmation: false,
    currentText: 'arbitrary multilingual request',
    context: [],
    manifests,
    ...overrides,
  };
}

describe('AI semantic router safety boundary', () => {
  it('drops hallucinated service and tool names', () => {
    const decision = sanitizeRouteDecision(
      {
        ...raw(),
        serviceIds: ['cards', 'invented_service'],
        toolNames: ['octane_card_status', 'delete_everything'],
        requiredToolNames: ['delete_everything', 'octane_card_status'],
      },
      input(),
    );
    expect(decision.serviceIds).toEqual(['cards']);
    expect(decision.toolNames).toEqual(['octane_card_status']);
    expect(decision.requiredToolNames).toEqual(['octane_card_status']);
  });

  it('always engages an authenticated user without granting unselected tools', () => {
    const decision = sanitizeRouteDecision(
      { ...raw(), engage: false, toolNames: [], requiredToolNames: [] },
      input('owner'),
    );
    expect(decision.engage).toBe(true);
  });

  it('builds handoff scope from semantic routing metadata', () => {
    const sales = selectAiToolPlan(
      manifests,
      raw({
        kind: 'out_of_scope',
        serviceIds: [],
        toolNames: [],
        requiredToolNames: [],
        handoff: 'sales',
      }),
      'owner',
    );
    expect(sales.tools.map((tool) => tool.name)).toEqual(['octane_whoami']);
    expect(sales.requiredSequence).toEqual(['octane_whoami']);

    const support = selectAiToolPlan(
      manifests,
      raw({
        kind: 'out_of_scope',
        serviceIds: [],
        toolNames: [],
        requiredToolNames: [],
        handoff: 'customer_service',
      }),
      'driver',
    );
    expect(support.tools.map((tool) => tool.name)).toEqual(['octane_whoami']);
  });

  it('never fails completed work because a best-effort UX tool was skipped', () => {
    const plan = selectAiToolPlan(
      manifests,
      raw({
        toolNames: ['octane_card_status', 'telegram_progress'],
        requiredToolNames: ['octane_card_status', 'telegram_progress'],
      }),
      'owner',
    );
    expect(plan.requiredSequence).toEqual(['octane_card_status']);
  });

  it('enforces RBAC after the AI asks for an owner-only tool', () => {
    const plan = selectAiToolPlan(
      manifests,
      raw({
        toolNames: ['octane_card_action'],
        requiredToolNames: ['octane_card_action'],
        trustedConfirmation: true,
      }),
      'driver',
    );
    expect(plan.tools.map((tool) => tool.name)).toEqual([
      'octane_whoami',
      'octane_kb_search',
    ]);
    expect(plan.roleDeniedTool).toBe('octane_card_action');
  });

  it('hides state mutation until a trusted Telegram confirmation', () => {
    const decision = raw({
      toolNames: ['octane_card_status', 'octane_card_action'],
      requiredToolNames: ['octane_card_action'],
    });
    expect(
      selectAiToolPlan(manifests, decision, 'owner').tools.map(
        (tool) => tool.name,
      ),
    ).toEqual(['octane_card_status']);
    expect(
      selectAiToolPlan(
        manifests,
        { ...decision, trustedConfirmation: true },
        'owner',
      ).requiredSequence,
    ).toEqual(['octane_card_action']);
  });

  it('honors a disabled service independently of the AI decision', () => {
    const plan = selectAiToolPlan(
      manifests,
      raw({
        serviceIds: ['money_code'],
        toolNames: ['octane_money_code_quote'],
        requiredToolNames: ['octane_money_code_quote'],
      }),
      'owner',
      parseServiceFlags('money_code=off'),
    );
    expect(plan).toMatchObject({
      tools: [],
      requiredSequence: [],
      unavailableService: 'money_code',
    });
  });

  it('uses safe read-only fallbacks when a support route selects no valid tool', () => {
    const plan = selectAiToolPlan(
      manifests,
      raw({ serviceIds: [], toolNames: [], requiredToolNames: [] }),
      'owner',
    );
    expect(plan.tools.map((tool) => tool.name)).toEqual([
      'octane_whoami',
      'octane_kb_search',
    ]);
  });
});
