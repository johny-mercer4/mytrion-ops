import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_DEPARTMENTS,
  applyDepartmentPolicy,
  departmentsForTool,
  resolveAgentPersona,
} from '../../src/modules/agents/departmentAgents.js';
import { toolRegistry } from '../../src/modules/tools/index.js';
import type { RegisteredTool } from '../../src/modules/tools/types.js';
import { makeContext } from '../fixtures/seed.js';

describe('departmentsForTool', () => {
  it('maps tools to the right gate (derived from the 10 agent manifests)', () => {
    expect(departmentsForTool('knowledge.search')).toEqual([]); // universal/open
    // manager grants management/c-level on the cross-department read tools it lists
    expect(departmentsForTool('agent.sales_snapshot').sort()).toEqual(['c-level', 'management', 'sales']);
    expect(departmentsForTool('agent.activity').sort()).toEqual(['c-level', 'management', 'sales']);
    expect(departmentsForTool('agent.debtors').sort()).toEqual(
      ['billing', 'c-level', 'collection', 'finance', 'management'],
    );
    expect(departmentsForTool('zoho_desk.search_tickets').sort()).toEqual(
      ['c-level', 'customer-service', 'management'],
    );
    expect(departmentsForTool('zoho_crm.query').sort()).toEqual([
      'billing', 'c-level', 'collection', 'customer-service', 'finance',
      'management', 'marketing', 'retention', 'sales', 'verification',
    ]);
    // HR lookups are manager-tier now (was admin-sentinel before the manager agent existed)
    expect(departmentsForTool('zoho_people.search_employees').sort()).toEqual(['c-level', 'management']);
    // not in any agent → admin-only sentinel
    expect(departmentsForTool('zoho_mcp.ZohoCRM_getRecords')).toEqual([...ADMIN_ONLY_DEPARTMENTS]);
    expect(departmentsForTool('telegram.send_message')).toEqual([...ADMIN_ONLY_DEPARTMENTS]);
  });
});

describe('applyDepartmentPolicy', () => {
  it('stamps allowedDepartments onto each tool', () => {
    const tools = [
      { name: 'knowledge.search' },
      { name: 'agent.debtors' },
      { name: 'zoho_mcp.X' },
    ] as RegisteredTool[];
    applyDepartmentPolicy(tools);
    expect(tools[0]!.allowedDepartments).toEqual([]);
    expect(tools[1]!.allowedDepartments!.sort()).toEqual(
      ['billing', 'c-level', 'collection', 'finance', 'management'],
    );
    expect(tools[2]!.allowedDepartments).toEqual([...ADMIN_ONLY_DEPARTMENTS]);
  });
});

describe('resolveAgentPersona', () => {
  it('admin (allDepartmentAccess) → unrestricted persona', () => {
    expect(resolveAgentPersona(makeContext({ allDepartmentAccess: true }))).toMatch(/unrestricted/i);
  });
  it('a known department → that department persona', () => {
    expect(resolveAgentPersona(makeContext({ allDepartmentAccess: false, departments: ['sales'] }))).toMatch(/Sales/);
    expect(resolveAgentPersona(makeContext({ allDepartmentAccess: false, departments: ['billing'] }))).toMatch(/Billing/);
    expect(resolveAgentPersona(makeContext({ allDepartmentAccess: false, departments: ['marketing'] }))).toMatch(/Marketing/);
    expect(resolveAgentPersona(makeContext({ allDepartmentAccess: false, departments: ['management'] }))).toMatch(/Manager/);
  });
  it('multiple departments → combined persona listing them', () => {
    const p = resolveAgentPersona(makeContext({ allDepartmentAccess: false, departments: ['sales', 'billing'] }));
    expect(p).toMatch(/Sales/);
    expect(p).toMatch(/Billing/);
  });
  it('no/unknown department → default (global-only) persona', () => {
    expect(resolveAgentPersona(makeContext({ allDepartmentAccess: false, departments: [] }))).toMatch(/no specific department/i);
  });
});

// The widget path: systemContext (scopes ['*']) + a per-request department_scope. Department gating
// is enforced purely by allowedDepartments + ctx.departments, independent of role/scopes.
describe('tool gating through the live registry (widget path)', () => {
  const dept = (departments: string[]) =>
    makeContext({ scopes: ['*'], audience: 'internal', departments, allDepartmentAccess: false });
  const names = (ctx: ReturnType<typeof dept>) => toolRegistry.listForContext(ctx).map((t) => t.name).sort();

  it('Sales sees sales + client-service tools + universal RAG, never another team’s tools', () => {
    const n = names(dept(['sales']));
    expect(n).toEqual([
      'agent.activity',
      'agent.sales_snapshot',
      'crm.carrier_balance',
      'crm.carrier_overview',
      'crm.list_cards',
      'crm.list_my_clients',
      'crm.payment_info',
      'crm.pick_my_client',
      'crm.transactions',
      'knowledge.search',
      'zoho_crm.query',
    ]);
    expect(n).not.toContain('agent.debtors');
    expect(n).not.toContain('zoho_desk.search_tickets');
    expect(n).not.toContain('zoho_people.search_employees');
  });

  it('Billing sees debtors + CRM + RAG, not sales/desk/client-service tools', () => {
    const n = names(dept(['billing']));
    expect(n).toEqual(['agent.debtors', 'knowledge.search', 'zoho_crm.query']);
    expect(n).not.toContain('crm.carrier_balance');
  });

  it('Customer Service sees Desk tickets + CRM + client-service tools + RAG', () => {
    expect(names(dept(['customer-service']))).toEqual([
      'crm.carrier_balance',
      'crm.carrier_overview',
      'crm.list_cards',
      'crm.list_my_clients',
      'crm.payment_info',
      'crm.pick_my_client',
      'crm.transactions',
      'knowledge.search',
      'zoho_crm.query',
      'zoho_desk.search_tickets',
    ]);
  });

  it('no-department caller sees only the universal RAG tool', () => {
    expect(names(dept([]))).toEqual(['knowledge.search']);
  });

  it('admin (allDepartmentAccess) sees every native tool', () => {
    const admin = makeContext({ scopes: ['*'], audience: 'internal', allDepartmentAccess: true });
    expect(toolRegistry.listForContext(admin).length).toBe(toolRegistry.all().length);
  });
});
