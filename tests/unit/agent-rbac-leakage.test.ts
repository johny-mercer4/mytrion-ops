/**
 * The headline multi-agent RBAC suite (CLAUDE.md rule 9): a caller routed through ANY agent
 * must never gain retrieval or tool access beyond their own departments — at any hop, by any
 * name, under any manifest. These tests must stay green before agent feature work proceeds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/toolCallRepo.js', () => ({
  toolCallRepo: { record: vi.fn(async () => undefined) },
}));
vi.mock('../../src/repos/auditRepo.js', () => ({
  auditRepo: { insert: vi.fn(async () => undefined) },
}));

import { agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import {
  effectiveRetrievalContext,
  narrowContext,
} from '../../src/modules/agents/authority.js';
import { ALL_AGENT_MANIFESTS } from '../../src/modules/agents/manifests/index.js';
import { dispatchTool } from '../../src/modules/chat/toolDispatcher.js';
import { toolRegistry } from '../../src/modules/tools/index.js';
import { knowledgeRepo } from '../../src/repos/knowledgeRepo.js';
import { KNOWN_DEPARTMENTS } from '../../src/lib/department.js';
import { RBACError } from '../../src/lib/errors.js';
import { toolCallRepo } from '../../src/repos/toolCallRepo.js';
import { makeContext } from '../fixtures/seed.js';

const EMBEDDING = new Array(1536).fill(0.01) as number[];

// The real widget path: API_KEY callers get the system context (admin role, '*' scopes) and
// department RBAC is applied per request — so leakage protection must hold on departments alone.
const salesCaller = () =>
  makeContext({ scopes: ['*'], audience: 'internal', departments: ['sales'], allDepartmentAccess: false });

/** Simulate M1 tool binding: RBAC listForContext(narrowed ctx) ∩ manifest allowlist. */
function boundToolNames(ctx: ReturnType<typeof salesCaller>, manifestKey: string): string[] {
  const manifest = agentRegistry.get(manifestKey as never)!;
  const narrowed = narrowContext(ctx, manifest);
  return toolRegistry
    .listForContext(narrowed)
    .filter((t) => manifest.tools.includes(t.name))
    .map((t) => t.name);
}

beforeEach(() => {
  vi.mocked(toolCallRepo.record).mockClear();
});

describe('retrieval SQL never references foreign departments — any agent, any hop', () => {
  const foreign = KNOWN_DEPARTMENTS.filter((d) => d !== 'sales');

  for (const manifest of ALL_AGENT_MANIFESTS) {
    it(`sales caller via '${manifest.key}' agent stays sales-scoped`, () => {
      const ectx = effectiveRetrievalContext(salesCaller(), manifest);
      expect(ectx.allDepartmentAccess).toBe(false);
      const { params } = knowledgeRepo.buildSearchQuery(ectx, EMBEDDING, 6).toSQL();
      const paramStrings = params.filter((p): p is string => typeof p === 'string');
      for (const dept of foreign) expect(paramStrings).not.toContain(dept);
    });
  }

  it('a reformulated (hostile) sub-query cannot change the filter — only ctx shapes the WHERE', () => {
    // The agentic-RAG planner only ever produces query STRINGS (embedded client-side);
    // filters come from ctx inside the repo. Different embeddings must yield identical
    // department params.
    const ectx = effectiveRetrievalContext(salesCaller(), agentRegistry.get('sales')!);
    const deptParams = (emb: number[]) =>
      knowledgeRepo
        .buildSearchQuery(ectx, emb, 6)
        .toSQL()
        .params.filter((p): p is string => typeof p === 'string')
        .filter((p) => (KNOWN_DEPARTMENTS as readonly string[]).includes(p));
    expect(deptParams(EMBEDDING)).toEqual(deptParams(new Array(1536).fill(0.99)));
  });
});

describe('tool binding never crosses departments', () => {
  it('sales caller gets no other-department or manager-tier tools through ANY agent', () => {
    for (const manifest of ALL_AGENT_MANIFESTS) {
      const bound = boundToolNames(salesCaller(), manifest.key);
      expect(bound).not.toContain('agent.debtors'); // billing/collection/finance tool
      expect(bound).not.toContain('zoho_people.search_employees'); // management-tier
      expect(bound).not.toContain('zoho_desk.search_tickets'); // customer-service tool
    }
  });

  it('the right agent still works: sales caller via sales agent keeps sales + client-service tools', () => {
    const bound = boundToolNames(salesCaller(), 'sales');
    expect(bound.sort()).toEqual([
      'agent.activity',
      'agent.sales_snapshot',
      'crm.carrier_balance',
      'crm.carrier_overview',
      'crm.list_cards',
      'crm.list_my_clients',
      'crm.payment_info',
      'crm.pick_my_client',
      'crm.transactions',
      'zoho_crm.query',
    ]);
  });

  it('admin via read-only manager agent is bounded: no write tools, no bypass', () => {
    const admin = makeContext({ allDepartmentAccess: true, bypassRbac: true });
    const manager = agentRegistry.get('manager')!;
    const narrowed = narrowContext(admin, manager);
    const bound = toolRegistry
      .listForContext(narrowed)
      .filter((t) => manager.tools.includes(t.name));
    expect(bound.every((t) => t.riskClass === 'read')).toBe(true);
    expect(narrowed.bypassRbac).toBeUndefined();
  });
});

describe('dispatch-by-name is denied even when a model hallucinates a tool it was not bound', () => {
  it('sales caller narrowed through the billing agent cannot dispatch agent.debtors', async () => {
    const narrowed = narrowContext(salesCaller(), agentRegistry.get('billing')!);
    await expect(dispatchTool('agent.debtors', {}, narrowed)).rejects.toThrow(RBACError);
    // The denial is recorded with the acting agent for audit.
    const recorded = vi.mocked(toolCallRepo.record).mock.calls.at(-1)?.[0];
    expect(recorded).toMatchObject({ status: 'denied', actingAgent: 'billing' });
  });

  it('read-only dispatch denies write tools even for admins (defense in depth)', async () => {
    const admin = makeContext({ role: 'admin', allDepartmentAccess: true });
    await expect(
      dispatchTool('telegram.send_message', { text: 'hi' }, admin, { readOnly: true }),
    ).rejects.toThrow(/read-only/);
  });

  it('customer audience cannot dispatch internal tools by name', async () => {
    const customer = makeContext({
      role: 'viewer',
      audience: 'customer',
      departments: ['5758544'],
      allDepartmentAccess: false,
      scopes: [],
    });
    await expect(
      dispatchTool('zoho_crm.query', { select_query: 'select id from Leads limit 0, 1' }, customer),
    ).rejects.toThrow(RBACError);
  });
});
