import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the servercrm HTTP layer so these are hermetic (no network).
const serverCrmGet = vi.fn();
vi.mock('../../src/integrations/serverCrm.js', () => ({
  serverCrmGet: (...args: unknown[]) => serverCrmGet(...args),
  serverCrmPost: vi.fn(),
}));

import { fetchAgentRoster } from '../../src/modules/tools/serverCrmScope.js';
import { crmPickMyClientTool } from '../../src/modules/tools/definitions/servercrm_client.js';
import { coerceElicitation } from '../../src/modules/agents/elicitation.js';
import { makeContext } from '../fixtures/seed.js';

const frank = () =>
  makeContext({
    userId: 'zoho:6227679000000676062',
    userName: 'Frank Harrison',
    departments: ['sales'],
    allDepartmentAccess: false,
  });
afterEach(() => serverCrmGet.mockReset());

describe('fetchAgentRoster — boolean coercion + owner id', () => {
  it('coerces servercrm 0/1 flags to real booleans', async () => {
    serverCrmGet.mockResolvedValue({
      agent_name: 'Frank Harrison',
      data: [
        { carrier_id: '5815958', company_name: '10WHEELSEXPRESS LLC', payment_terms: 'LOC', is_active: 1, is_debtor: 0 },
        { carrier_id: 5789315, company_name: 'UMMAH EXPRESS LLC', payment_terms: 'LOC', is_active: 0, is_debtor: 1 },
      ],
    });
    const roster = await fetchAgentRoster(frank());
    expect(serverCrmGet).toHaveBeenCalledWith('/api/clients/by-agent/6227679000000676062', { limit: 200 });
    expect(roster.carriers[0]).toEqual({
      carrierId: 5815958,
      companyName: '10WHEELSEXPRESS LLC',
      paymentTerms: 'LOC',
      isActive: true,
      isDebtor: false,
    });
    expect(roster.carriers[1]!.isActive).toBe(false);
    expect(roster.carriers[1]!.isDebtor).toBe(true);
  });
});

// assertCarrierOwned now resolves through the DWH roster authority, not servercrm's by-agent —
// its coverage (arms, cache, 502-vs-RBAC, admin skip) lives in tests/unit/carrier-ownership.test.ts.

describe('crm.pick_my_client — server-built picker states', () => {
  const run = (input: Record<string, unknown>) =>
    crmPickMyClientTool.handler(crmPickMyClientTool.inputSchema.parse(input), frank());

  it('none when the roster is empty', async () => {
    serverCrmGet.mockResolvedValue({ data: [] });
    expect(await run({})).toMatchObject({ status: 'none', count: 0 });
  });

  it('resolves automatically on a single match', async () => {
    serverCrmGet.mockResolvedValue({ data: [{ carrier_id: '5816381', company_name: 'ALI CARGO INC', is_active: 1 }] });
    expect(await run({ search: 'ALI CARGO' })).toMatchObject({
      status: 'resolved',
      carrierId: 5816381,
      companyName: 'ALI CARGO INC',
    });
  });

  it('returns a choose elicitation with REAL server-built options for a small match set', async () => {
    serverCrmGet.mockResolvedValue({
      data: [
        { carrier_id: '5816381', company_name: 'ALI CARGO INC', payment_terms: 'LOC', is_debtor: 0 },
        { carrier_id: '5803004', company_name: 'KV QUALITY TRANSPORTATION LLC', payment_terms: 'LOC', is_debtor: 1 },
      ],
    });
    const out = await run({ search: 'ALI' });
    expect(out.status).toBe('choose');
    const e = coerceElicitation(out.elicitation);
    expect(e?.field).toBe('carrier_id');
    expect(e?.options).toEqual([
      { label: 'ALI CARGO INC', value: '5816381', hint: 'LOC' },
      { label: 'KV QUALITY TRANSPORTATION LLC', value: '5803004', hint: 'LOC · Debtor' },
    ]);
  });

  it('forces a search when there are too many clients (no giant picklist)', async () => {
    serverCrmGet.mockResolvedValue({
      data: Array.from({ length: 40 }, (_, i) => ({ carrier_id: String(1000 + i), company_name: `CO ${i}` })),
    });
    expect(await run({})).toMatchObject({ status: 'too_many', count: 40 });
  });
});

describe('coerceElicitation', () => {
  it('coerces number values to strings and drops malformed options', () => {
    const e = coerceElicitation({
      prompt: 'Which client?',
      field: 'carrier_id',
      options: [
        { label: 'ALI CARGO INC', value: 5816381 }, // number → string
        { label: 'missing value' },
        'not an object',
      ],
    });
    expect(e?.options).toEqual([{ label: 'ALI CARGO INC', value: '5816381' }]);
  });

  it('returns undefined when there are no valid options', () => {
    expect(coerceElicitation({ options: [] })).toBeUndefined();
    expect(coerceElicitation(null)).toBeUndefined();
  });
});
