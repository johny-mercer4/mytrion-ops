import { describe, expect, it } from 'vitest';

import {
  SALES_AGENT_DEFAULT_PINNED,
  SALES_AGENT_LAST_USED_ITEM,
  SALES_AGENT_LIVE_ACTIONS,
  migrateSalesAgentPinned,
  salesAgentActionFor,
} from '../../apps/mini-app/src/lib/salesAgentCatalog.js';

describe('mini-app Sales-agent service catalog', () => {
  it('keeps only explicitly reviewed read-only owner services interactive', () => {
    expect(SALES_AGENT_LIVE_ACTIONS).toEqual({
      'fin-balance': 'balance',
      'fin-txn-reports': 'txns',
      'fin-invoice-view': 'invoices',
      'fin-payment-status': 'payment',
      'card-status': 'status',
      'card-track': 'tracking',
      'doc-billing-form': 'billingform',
    });
    expect(salesAgentActionFor('card-activate')).toBeNull();
    expect(salesAgentActionFor('acct-reactivate')).toBeNull();
    expect(SALES_AGENT_LAST_USED_ITEM.action).toBe('lastused');
  });

  it('pins owner-keyed read services and migrates existing Sales preferences', () => {
    expect(SALES_AGENT_DEFAULT_PINNED).toEqual([
      'card-status',
      'fin-balance',
      'fin-txn-reports',
      'fin-invoice-view',
    ]);
    expect(migrateSalesAgentPinned(['agent-status', 'agent-balance', 'agent-last-used'])).toEqual([
      'card-status',
      'fin-balance',
      'agent-last-used',
    ]);
  });
});
