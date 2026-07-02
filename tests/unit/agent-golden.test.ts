/**
 * Golden policy suite — locks each agent's effective posture so a manifest edit that widens
 * (or silently breaks) an agent's authority fails CI loudly. For each of the 10 agents, under
 * a caller from its own primary department: the exact bound registry tools, the effective RAG
 * departments, read-only posture, and valid escalation targets.
 * (Behavioral golden tasks with a scripted model run via scripts/evalLive.ts — not in CI.)
 */
import { describe, expect, it } from 'vitest';
import { agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import { effectiveRetrievalContext, narrowContext } from '../../src/modules/agents/authority.js';
import { ALL_AGENT_MANIFESTS } from '../../src/modules/agents/manifests/index.js';
import { AGENT_KEYS, isAgentKey } from '../../src/modules/agents/types.js';
import { toolRegistry } from '../../src/modules/tools/index.js';
import { makeContext } from '../fixtures/seed.js';

// File tools appear only when FF_FILES_ENABLED registers them; golden values assume default-off.
// crm.* client-service tools are on sales + customer-service (owner-scoped self-service).
const CLIENT_TOOLS = [
  'crm.carrier_balance',
  'crm.carrier_overview',
  'crm.list_cards',
  'crm.list_my_clients',
  'crm.payment_info',
  'crm.pick_my_client',
  'crm.transactions',
];

const GOLDEN: Record<string, { caller: string[]; tools: string[]; rag: string[] }> = {
  sales: {
    caller: ['sales'],
    tools: ['agent.activity', 'agent.sales_snapshot', ...CLIENT_TOOLS, 'zoho_crm.query'].sort(),
    rag: ['sales'],
  },
  marketing: { caller: ['marketing'], tools: ['zoho_crm.query'], rag: ['marketing'] },
  billing: { caller: ['billing'], tools: ['agent.debtors', 'zoho_crm.query'], rag: ['billing'] },
  'customer-service': {
    caller: ['customer-service'],
    tools: [...CLIENT_TOOLS, 'zoho_crm.query', 'zoho_desk.search_tickets'].sort(),
    rag: ['customer-service'],
  },
  verification: { caller: ['verification'], tools: ['zoho_crm.query'], rag: ['verification'] },
  retention: { caller: ['retention'], tools: ['zoho_crm.query'], rag: ['retention'] },
  collection: { caller: ['collection'], tools: ['agent.debtors', 'zoho_crm.query'], rag: ['collection'] },
  finance: { caller: ['finance'], tools: ['agent.debtors', 'zoho_crm.query'], rag: ['finance'] },
  // analyst/manager goldens use an admin caller (their tier); rag [] = unfiltered-by-scope.
  analyst: {
    caller: [],
    tools: ['agent.activity', 'agent.debtors', 'agent.sales_snapshot', 'zoho_crm.query', 'zoho_desk.search_tickets'],
    rag: [],
  },
  manager: {
    caller: [],
    tools: [
      'agent.activity',
      'agent.debtors',
      'agent.sales_snapshot',
      'zoho_crm.query',
      'zoho_desk.search_tickets',
      'zoho_people.search_employees',
    ],
    rag: [],
  },
};

function callerFor(key: string): ReturnType<typeof makeContext> {
  const golden = GOLDEN[key]!;
  return golden.caller.length === 0
    ? makeContext({ allDepartmentAccess: true })
    : makeContext({ scopes: ['*'], departments: golden.caller, allDepartmentAccess: false });
}

describe('golden per-agent policy (10 agents)', () => {
  for (const manifest of ALL_AGENT_MANIFESTS) {
    const golden = GOLDEN[manifest.key];
    it(`${manifest.key}: bound tools, RAG scope, and escalation targets match the golden record`, () => {
      expect(golden, `add a golden record for new agent '${manifest.key}'`).toBeDefined();
      const ctx = callerFor(manifest.key);
      const narrowed = narrowContext(ctx, manifest);

      const bound = toolRegistry
        .listForContext(narrowed)
        .filter((t) => manifest.tools.includes(t.name))
        .filter((t) => !manifest.readOnly || t.riskClass === 'read')
        .map((t) => t.name)
        .sort();
      expect(bound).toEqual(golden!.tools);

      const retrieval = effectiveRetrievalContext(ctx, manifest);
      if (golden!.rag.length > 0) {
        expect(retrieval.allDepartmentAccess).toBe(false);
        expect(retrieval.departments.sort()).toEqual(golden!.rag);
      } else {
        expect(manifest.ragScope.allowAllDepartments).toBe(true);
      }

      for (const target of manifest.delegatesTo) {
        expect(isAgentKey(target)).toBe(true);
        expect(agentRegistry.get(target)).toBeDefined();
      }
      expect(manifest.persona.length).toBeGreaterThan(50);
      expect(manifest.description.length).toBeGreaterThan(30);
    });
  }

  it('read-only agents are exactly analyst + manager', () => {
    const readOnly = ALL_AGENT_MANIFESTS.filter((m) => m.readOnly).map((m) => m.key).sort();
    expect(readOnly).toEqual(['analyst', 'manager']);
  });

  it('every AGENT_KEY has a golden record (adding an agent forces a policy review)', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual([...AGENT_KEYS].sort());
  });
});
