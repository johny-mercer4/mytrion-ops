import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/dwh.js', () => ({
  dwhQuery: vi.fn(),
  getDwhPool: vi.fn(),
  closeDwhPool: vi.fn(async () => undefined),
}));

import { dwhQuery } from '../../src/integrations/dwh.js';
import {
  clearClientRosterCache,
  fetchAgentClients,
} from '../../src/integrations/dwhClientRoster.js';

const query = vi.mocked(dwhQuery);
const AGENT_ID = '6227679000000676062';

function activeClientRow() {
  return {
    carrier_id: '5785947',
    company_name: 'David Kolhelly',
    deal_full_name: 'David Kolhelly',
    agent: 'Daniel Brown',
    deal_phone: null,
    contact_phone: null,
    total_produced_cards: 4,
    total_active_cards: 4,
    tier_name: 'Gold',
    deal_money_code: null,
    comdata_id: null,
    dot: '3642739',
    trucks: 4,
    is_loc_suspended: false,
    computed_is_active: true,
    computed_debt: 0,
    computed_debt_days: 0,
    cycle_gallons: 1000,
    gallons_this_month: 1000,
    in_network_gallons_this_month: 900,
    active_cards_this_month: 4,
    transactions_this_month: 20,
    gallons_prev_month: 800,
    in_network_gallons_prev_month: 700,
    active_cards_prev_month: 4,
  };
}

beforeEach(() => {
  clearClientRosterCache();
  query.mockReset();
});

describe('DWH client roster strict refresh', () => {
  it('does not return a cached snapshot when stale fallback is disabled', async () => {
    query.mockResolvedValueOnce([activeClientRow()]);
    await fetchAgentClients(AGENT_ID, 'Daniel Brown');

    query.mockRejectedValueOnce(new Error('warehouse offline'));
    await expect(
      fetchAgentClients(AGENT_ID, 'Daniel Brown', {
        force: true,
        allowStaleOnError: false,
      }),
    ).rejects.toThrow('warehouse offline');
  });

  it('does not join a stale-tolerant in-flight refresh during an authorization check', async () => {
    query.mockResolvedValueOnce([activeClientRow()]);
    const cached = await fetchAgentClients(AGENT_ID, 'Daniel Brown');

    let rejectUiRefresh: (reason: unknown) => void = () => undefined;
    const uiRefreshQuery = new Promise<never>((_resolve, reject) => {
      rejectUiRefresh = reject;
    });
    query.mockImplementationOnce(() => uiRefreshQuery);
    query.mockRejectedValueOnce(new Error('strict refresh failed'));

    const uiRefresh = fetchAgentClients(AGENT_ID, 'Daniel Brown', { force: true });
    const authorizationRefresh = fetchAgentClients(AGENT_ID, 'Daniel Brown', {
      force: true,
      allowStaleOnError: false,
    });

    await expect(authorizationRefresh).rejects.toThrow('strict refresh failed');
    rejectUiRefresh(new Error('UI refresh failed'));
    await expect(uiRefresh).resolves.toEqual(cached);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
