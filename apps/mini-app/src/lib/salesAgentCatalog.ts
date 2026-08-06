/**
 * Explicit Sales-agent preview catalog. This module deliberately has no React or DOM imports so
 * the repository-level regression suite can verify the read-only boundary under the backend
 * tsconfig as well as the mini-app build.
 */
export const SALES_AGENT_CATALOG_DEFINITION = [
  {
    groupLabelKey: 'svcgrp.finance',
    items: [
      { key: 'agent-balance', labelKey: 'svc.balance', icon: 'wallet', action: 'balance' },
      { key: 'agent-txns', labelKey: 'svc.txns', icon: 'list', action: 'txns' },
      { key: 'agent-invoices', labelKey: 'svc.invoices', icon: 'doc', action: 'invoices' },
      { key: 'agent-payment', labelKey: 'svc.payment', icon: 'card', action: 'payment' },
    ],
  },
  {
    groupLabelKey: 'svcgrp.cardMgmt',
    items: [
      { key: 'agent-status', labelKey: 'svc.status', icon: 'shield', action: 'status' },
      { key: 'agent-last-used', labelKey: 'svc.lastused', icon: 'clock', action: 'lastused' },
    ],
  },
] as const;

export const SALES_AGENT_DEFAULT_PINNED = [
  'agent-status',
  'agent-balance',
  'agent-txns',
  'agent-invoices',
] as const;
