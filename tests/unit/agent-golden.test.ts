/**
 * Golden policy suite — locks each agent's effective posture so a manifest edit that widens
 * (or silently breaks) an agent's authority fails CI loudly. For each registered agent, under
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
// Blackboard tools register when FF_AGENT_BLACKBOARD is on (default ON as of SotA Phase 1).
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
const BLACKBOARD = ['blackboard.read', 'blackboard.write'] as const;

// Warehouse metrics go through dbt MCP (`dbt_mcp.*` wildcards + warehouse.my_gallons). Those tools
// register only when FF_DBT_MCP_ENABLED (off in vitest baseline), so goldens list the static
// native tools only. analytics.snapshot is NOT agent-bound (direct DWH pool — dashboard-only).
const GOLDEN: Record<string, { caller: string[]; tools: string[]; rag: string[] }> = {
  sales: {
    caller: ['sales'],
    tools: ['agent.activity', 'agent.sales_snapshot', ...BLACKBOARD, ...CLIENT_TOOLS, 'zoho_crm.query'].sort(),
    rag: ['sales'],
  },
  'data-center': {
    caller: ['sales'],
    tools: ['agent.activity', 'agent.sales_snapshot', ...BLACKBOARD, ...CLIENT_TOOLS, 'zoho_crm.query'].sort(),
    rag: ['sales'],
  },
  marketing: {
    caller: ['marketing'],
    tools: [...BLACKBOARD, 'zoho_crm.query'].sort(),
    rag: ['marketing'],
  },
  billing: {
    caller: ['billing'],
    tools: ['agent.debtors', ...BLACKBOARD, 'zoho_crm.query'].sort(),
    rag: ['billing'],
  },
  'customer-service': {
    caller: ['customer-service'],
    tools: [...BLACKBOARD, ...CLIENT_TOOLS, 'zoho_crm.query', 'zoho_desk.search_tickets'].sort(),
    rag: ['customer-service'],
  },
  verification: {
    caller: ['verification'],
    tools: [...BLACKBOARD, 'zoho_crm.query'].sort(),
    rag: ['verification'],
  },
  retention: {
    caller: ['retention'],
    tools: [...BLACKBOARD, 'zoho_crm.query'].sort(),
    rag: ['retention'],
  },
  collection: {
    caller: ['collection'],
    tools: ['agent.debtors', ...BLACKBOARD, 'zoho_crm.query'].sort(),
    rag: ['collection'],
  },
  finance: {
    caller: ['finance'],
    tools: ['agent.debtors', ...BLACKBOARD, 'zoho_crm.query'].sort(),
    rag: ['finance'],
  },
  // analyst/manager goldens use an admin caller (their tier); rag [] = unfiltered-by-scope.
  analyst: {
    caller: [],
    tools: [
      'agent.activity',
      'agent.debtors',
      'agent.sales_snapshot',
      ...BLACKBOARD,
      'zoho_crm.query',
      'zoho_desk.search_tickets',
    ].sort(),
    rag: [],
  },
  manager: {
    caller: [],
    tools: [
      'agent.activity',
      'agent.debtors',
      'agent.sales_snapshot',
      ...BLACKBOARD,
      'zoho_crm.query',
      'zoho_desk.search_tickets',
      'zoho_people.search_employees',
    ].sort(),
    rag: [],
  },
};

function callerFor(key: string): ReturnType<typeof makeContext> {
  const golden = GOLDEN[key]!;
  return golden.caller.length === 0
    ? makeContext({ allDepartmentAccess: true })
    : makeContext({ scopes: ['*'], departments: golden.caller, allDepartmentAccess: false });
}

describe('golden per-agent policy', () => {
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

/**
 * Bound-tool-surface budget.
 *
 * `zoho_mcp.*` on sales/data-center/manager expanded to all 83 discovered Zoho MCP read tools. Every
 * schema is input tokens on every model call — measured at 71,130 input tokens per call, which spent
 * the org's 200k-tokens-per-minute quota in ~1.4 questions and returned 429s the UI showed as
 * "network error" — and tool choice degraded badly at that size (a how-to question picked
 * `zoho_crm.query`). Nothing in CI noticed, because MCP tools only exist after live discovery.
 *
 * These tests fail on a re-introduced wildcard and on a manifest that quietly grows past budget.
 */
describe('bound tool surface stays affordable', () => {
  /**
   * Simulates a live discovery: every MCP tool a manifest actually names, plus enough unrelated ones
   * to reach the 83 the real server registers. Including the named ones is what makes the budget
   * figures below real rather than accidentally zero.
   */
  const NAMED_MCP_TOOLS = [
    ...new Set(ALL_AGENT_MANIFESTS.flatMap((m) => m.tools.filter((t) => t.startsWith('zoho_mcp.')))),
  ];
  const FAKE_MCP_TOOLS = [
    ...NAMED_MCP_TOOLS,
    ...Array.from({ length: 83 - NAMED_MCP_TOOLS.length }, (_, i) => `zoho_mcp.ZohoCRM_other${i}`),
  ];

  it('no manifest wildcards the Zoho MCP namespace', () => {
    const offenders = ALL_AGENT_MANIFESTS.filter((m) =>
      m.tools.some((t) => t.startsWith('zoho_mcp.') && t.endsWith('*')),
    ).map((m) => m.key);
    expect(
      offenders,
      'A zoho_mcp.* wildcard binds every discovered MCP tool. Name the specific tools instead — ' +
        'see SALES_MCP_TOOLS / MANAGER_MCP_TOOLS in manifests/shared.ts.',
    ).toEqual([]);
  });

  it('an MCP wildcard would have matched the whole namespace (guards the matcher itself)', () => {
    const matches = (patterns: readonly string[], name: string): boolean =>
      patterns.some((p) => p === name || (p.endsWith('.*') && name.startsWith(p.slice(0, -1))));
    expect(FAKE_MCP_TOOLS).toHaveLength(83);
    expect(FAKE_MCP_TOOLS.filter((n) => matches(['zoho_mcp.*'], n))).toHaveLength(83);
    // The curated form matches only what it names.
    const one = NAMED_MCP_TOOLS[0] as string;
    expect(FAKE_MCP_TOOLS.filter((n) => matches([one], n))).toEqual([one]);
  });

  it('keeps every agent under a 30-tool budget even with 83 MCP tools discovered', () => {
    const matches = (patterns: readonly string[], name: string): boolean =>
      patterns.some((p) => p === name || (p.endsWith('.*') && name.startsWith(p.slice(0, -1))));
    const overBudget = ALL_AGENT_MANIFESTS.map((m) => {
      const native = toolRegistry.all().filter((t) => matches(m.tools, t.name)).length;
      const mcp = FAKE_MCP_TOOLS.filter((n) => matches(m.tools, n)).length;
      return { key: m.key, bound: native + mcp };
    }).filter((row) => row.bound > 30);
    expect(overBudget, 'Tool count drives prompt size and wrecks tool selection.').toEqual([]);

    // Sanity: the agents that DO name MCP tools really bind them, so the budget above is measuring
    // something. Sales bound ~101 tools under the old wildcard.
    const sales = ALL_AGENT_MANIFESTS.find((m) => m.key === 'sales');
    expect(FAKE_MCP_TOOLS.filter((n) => matches(sales?.tools ?? [], n)).length).toBeGreaterThan(0);
  });
});

/**
 * Prompt coherence for how-to intent.
 *
 * The Sales persona carried the self-knowledge rule ("call knowledge_search first") AND
 * "Use these directly to avoid searching the knowledge base for basic queries". Two instructions
 * pulling opposite ways, which is why "how do I activate a card in Sales Mytrion" called
 * zoho_crm.query twice. Prompts have no type system, so this is the only cheap guard.
 */
describe('Sales persona does not contradict itself on how-to intent', () => {
  const sales = ALL_AGENT_MANIFESTS.find((m) => m.key === 'sales');
  const persona = (): string => {
    expect(sales, 'sales manifest must exist').toBeDefined();
    return sales?.persona ?? '';
  };

  it('never tells the model to avoid the knowledge base', () => {
    expect(persona()).not.toMatch(/avoid searching the knowledge base/i);
  });

  it('forbids live-data tools for a how-to answer', () => {
    const text = persona();
    expect(text).toMatch(/how-to answer comes from knowledge_search ALONE/i);
    // The tools that actually got mis-called must be named, not implied.
    for (const tool of ['zoho_crm.query', 'crm.*', 'warehouse.*', 'dbt_mcp.*']) {
      expect(text, `${tool} should be named in the how-to prohibition`).toContain(tool);
    }
  });

  it('discourages repeating the same retrieval', () => {
    expect(persona()).toMatch(/do not repeat the same search/i);
  });

  it('still keeps the self-knowledge routing rule and the no-false-completion rule', () => {
    const text = persona();
    expect(text).toMatch(/SALES MYTRION SELF-KNOWLEDGE/);
    expect(text).toMatch(/does NOT require escalation just because/i);
    expect(text).toMatch(/never say you completed a change without an authorized tool result/i);
  });
});
