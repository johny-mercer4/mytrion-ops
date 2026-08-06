/**
 * Sales-agent company-preview policy. The Services tab mirrors the full owner catalog, but only
 * these explicitly reviewed read-only items remain interactive. Live owner write/request features
 * are labeled `Read only`; genuinely unreleased owner features keep their normal `Soon` state.
 *
 * This lets Sales explain the full roadmap without gaining owner writes. The module deliberately
 * has no React or DOM imports, so the repository-level regression suite can verify the boundary.
 */
export const SALES_AGENT_LIVE_ACTIONS = {
  'fin-balance': 'balance',
  'fin-txn-reports': 'txns',
  'fin-invoice-view': 'invoices',
  'fin-payment-status': 'payment',
  'card-status': 'status',
  'card-track': 'tracking',
  'doc-billing-form': 'billingform',
} as const;

export type SalesAgentLiveCatalogKey = keyof typeof SALES_AGENT_LIVE_ACTIONS;

export function salesAgentActionFor(
  key: string,
): (typeof SALES_AGENT_LIVE_ACTIONS)[SalesAgentLiveCatalogKey] | null {
  return Object.prototype.hasOwnProperty.call(SALES_AGENT_LIVE_ACTIONS, key)
    ? SALES_AGENT_LIVE_ACTIONS[key as SalesAgentLiveCatalogKey]
    : null;
}

/** Last-used is a safe fleet read that is useful during onboarding but has no owner catalog row. */
export const SALES_AGENT_LAST_USED_ITEM = {
  key: 'agent-last-used',
  labelKey: 'svc.lastused',
  icon: 'clock',
  action: 'lastused',
} as const;

export const SALES_AGENT_DEFAULT_PINNED = [
  'card-status',
  'fin-balance',
  'fin-txn-reports',
  'fin-invoice-view',
] as const;

const LEGACY_PIN_KEYS: Readonly<Record<string, string>> = {
  'agent-status': 'card-status',
  'agent-balance': 'fin-balance',
  'agent-txns': 'fin-txn-reports',
  'agent-invoices': 'fin-invoice-view',
  'agent-payment': 'fin-payment-status',
};

/** Preserve Sales agents' existing quick-action choices after adopting owner catalog keys. */
export function migrateSalesAgentPinned(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => LEGACY_PIN_KEYS[key] ?? key))];
}
