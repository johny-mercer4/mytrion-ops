import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../src/integrations/dwh.js', () => ({
  dwh: { query: mocks.query },
}));

import { getAgentVerificationClients } from '../../src/modules/verificationPipeline/service.js';

describe('Verification DWH roster pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([{
      carrier_id: '5837291',
      company_name: 'Acme Transport',
      deal_stage: 'Application Submitted',
      application_id: 'app-1',
      dot: '1234567',
      credit_score: null,
      credit_limit: null,
      billing_cycle: null,
      payment_terms: null,
      payment_day: null,
      minimum_required_balance: null,
      first_swipe_date: null,
      last_transaction_date: null,
      total_active_cards: 0,
      total_swiped_cards: 0,
      active_cards_last_30_days: 0,
      is_active: 0,
      is_loc_suspended: false,
      is_debtor: false,
      deal_id: 'deal-1',
      deal_name: 'Acme Transport',
      agent: 'Sales Agent',
      country: 'US',
      contact_source: 'Web',
      appfilldate: '2026-08-01',
      total_count: '39',
    }]);
  });

  it('binds page size, offset, and search without downloading the full roster', async () => {
    const result = await getAgentVerificationClients('42', 'Sales Agent', {
      page: 3,
      pageSize: 9,
      search: 'Acme',
    });

    const [sql, params] = mocks.query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain('left join lateral');
    expect(sql).toContain('limit $3 offset $4');
    expect(sql).toContain('count(*) over()');
    expect(params).toEqual(['Sales Agent', 'acme', 9, 18]);
    expect(result).toMatchObject({ total: 39, clients: [{ dealId: 'deal-1' }] });
  });
});
