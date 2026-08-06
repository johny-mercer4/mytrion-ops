import { describe, expect, it } from 'vitest';

import {
  SALES_AGENT_CATALOG_DEFINITION,
  SALES_AGENT_DEFAULT_PINNED,
} from '../../apps/mini-app/src/lib/salesAgentCatalog.js';

describe('mini-app Sales-agent service catalog', () => {
  it('contains only the explicit read-only company-preview actions', () => {
    const items = [
      ...SALES_AGENT_CATALOG_DEFINITION[0].items,
      ...SALES_AGENT_CATALOG_DEFINITION[1].items,
    ];

    expect(items.map((item) => item.key)).toEqual([
      'agent-balance',
      'agent-txns',
      'agent-invoices',
      'agent-payment',
      'agent-status',
      'agent-last-used',
    ]);
    expect(items.map((item) => item.action)).toEqual([
      'balance',
      'txns',
      'invoices',
      'payment',
      'status',
      'lastused',
    ]);
  });

  it('pins only services present in the read-only catalog', () => {
    const keys = new Set<string>([
      ...SALES_AGENT_CATALOG_DEFINITION[0].items.map((item) => item.key),
      ...SALES_AGENT_CATALOG_DEFINITION[1].items.map((item) => item.key),
    ]);

    expect(SALES_AGENT_DEFAULT_PINNED).toEqual([
      'agent-status',
      'agent-balance',
      'agent-txns',
      'agent-invoices',
    ]);
    expect(SALES_AGENT_DEFAULT_PINNED.every((key) => keys.has(key))).toBe(true);
    expect(keys.has('fin-money-code')).toBe(false);
  });
});
