/**
 * Manager Mytrion → EFS Console API.
 *
 * Two shapes matter here and both are unusual enough to state up front:
 *
 * 1. **The roster is warehouse-only.** `listEfsClients` reads `octane.dim_company` and touches no
 *    vendor endpoint, so it returns in milliseconds. Every `fetchEfs` call is live EFS SOAP and
 *    takes 1–11 SECONDS (measured against prod: carrier snapshot 1.1s, cards 5.0s, parent
 *    discounts 11.1s). Nothing in this console may fan out on mount.
 *
 * 2. **Partial success is normal.** EFS routinely answers 200 with one leg failed —
 *    `parent/snapshot` carries `creditLimitsError`, `carrier/snapshot` carries `cardDetailError`.
 *    The payload passes through untouched so a panel can show a warning chip beside good data
 *    rather than throwing the whole page away.
 *
 * Money-code digits are stripped server-side and never arrive here. Rows carry `codeLast4`.
 */
import { request } from './transport';

// ─── Capabilities ────────────────────────────────────────────────────────────────────────────

export type EfsWriteMode = 'disabled' | 'armed';
export type EfsWindowRule = 'none' | 'txn7d' | 'history90d';
export type EfsLatency = 'fast' | 'slow' | 'very-slow';
export type EfsHealth = 'ok' | 'broken';
export type EfsRiskClass = 'write' | 'money' | 'destructive';

export interface EfsFetcherInfo {
  key: string;
  side: 'parent' | 'carrier';
  label: string;
  window: EfsWindowRule;
  latency: EfsLatency;
  health: EfsHealth;
  brokenReason?: string;
  pathParams?: string[];
  query?: string[];
}

export interface EfsActionInfo {
  key: string;
  label: string;
  group: string;
  riskClass: EfsRiskClass;
  effect: string;
  checks: string[];
  /** Which console surface owns the button, or null when the action is declared but has no UI. */
  ui: 'cards' | 'money-codes' | null;
  /** Server-authoritative. The UI renders no Execute control unless this is true. */
  live: boolean;
}

export interface EfsCapabilities {
  writes: { mode: EfsWriteMode; liveActions: string[]; note: string };
  /** Vendor ceilings, published so the date picker can refuse a range instead of EFS 400ing. */
  windows: { txn7d: number | null; history90d: number | null };
  fetchers: EfsFetcherInfo[];
  actions: EfsActionInfo[];
}

export async function getEfsCapabilities(): Promise<EfsCapabilities> {
  return (await request('GET', '/manager/efs/capabilities')) as EfsCapabilities;
}

// ─── Roster (dim_company) ────────────────────────────────────────────────────────────────────

export interface EfsClient {
  carrierId: string;
  companyName: string;
  contractId: string | null;
  isActive: boolean;
  isDebtor: boolean;
  isLocSuspended: boolean;
  activeCards: number;
  producedCards: number;
  creditLimit: number | null;
  debtAmount: number | null;
  agent: string | null;
  tierName: string | null;
  lastTransactionDate: string | null;
}

export type EfsClientStatus = 'all' | 'active' | 'inactive' | 'debtor' | 'suspended';

export interface EfsClientPage {
  clients: EfsClient[];
  total: number;
  limit: number;
  offset: number;
}

export async function listEfsClients(
  filter: { q?: string; status?: EfsClientStatus; limit?: number; offset?: number } = {},
): Promise<EfsClientPage> {
  const query: Record<string, string | number | undefined> = { ...filter };
  return (await request('GET', '/manager/efs/clients', { query })) as EfsClientPage;
}

export async function getEfsClient(carrierId: string): Promise<EfsClient> {
  const data = (await request('GET', `/manager/efs/clients/${encodeURIComponent(carrierId)}`)) as {
    client: EfsClient;
  };
  return data.client;
}

// ─── Live EFS reads ──────────────────────────────────────────────────────────────────────────

export interface EfsFetchResult<T = unknown> {
  key: string;
  /** Resolved window the server actually asked for, or null on windowless endpoints. */
  window: { from: string; to: string; days: number } | null;
  fetchedAt: string;
  payload: T;
}

/**
 * Run one catalogued read. `key` is a catalog key (`carrier.cards`), never a vendor path — the
 * server owns the path, the window rule and the redaction.
 *
 * Slow by nature. Callers should render a skeleton and must not chain these on mount.
 */
export async function fetchEfs<T = unknown>(
  key: string,
  params: Record<string, string | number | undefined> = {},
): Promise<EfsFetchResult<T>> {
  const query: Record<string, string | number | undefined> = { ...params };
  return (await request('GET', `/manager/efs/fetch/${encodeURIComponent(key)}`, {
    query,
  })) as EfsFetchResult<T>;
}

/** The two reads that take a body (`parent.childrenByIds`, `loads.bulk`). */
export async function fetchEfsWithBody<T = unknown>(
  key: string,
  body: unknown,
): Promise<EfsFetchResult<T>> {
  return (await request('POST', `/manager/efs/fetch/${encodeURIComponent(key)}`, {
    body,
  })) as EfsFetchResult<T>;
}

// ─── Actions (inert today) ───────────────────────────────────────────────────────────────────

export interface EfsActionPreview {
  key: string;
  label: string;
  effect: string;
  riskClass: EfsRiskClass;
  checks: string[];
  /** Exactly what would be sent, after server-side validation. */
  wouldSend: unknown;
  wouldCall: string;
  executed: false;
  reason: 'writes_disabled' | 'action_not_live';
}

/**
 * Submit an action. While writes are disabled the server validates, audits and returns a preview
 * WITHOUT calling EFS — so this is safe to wire up now and genuinely useful: it proves a payload
 * is well-formed and records what would have been sent.
 */
export async function runEfsAction(
  key: string,
  body: Record<string, unknown>,
): Promise<{ preview: EfsActionPreview } | { executed: true; result: unknown }> {
  return (await request('POST', `/manager/efs/actions/${encodeURIComponent(key)}`, { body })) as
    | { preview: EfsActionPreview }
    | { executed: true; result: unknown };
}

// ─── Shapes the console reads out of otherwise-opaque payloads ───────────────────────────────

/** `parent.snapshot`. Sibling `*Error` fields are per-leg failures, not a failed call. */
export interface EfsParentSnapshot {
  success?: boolean;
  parent?: { totalBalance?: number; contracts?: Array<{ contractId?: string; description?: string; balance?: number }> };
  contracts?: { value?: Record<string, unknown> };
  contractsError?: string | null;
  creditLimits?: unknown;
  creditLimitsError?: string | null;
  fetchedAt?: string;
}

/** `carrier.snapshot`. `cardDetailError` set means contracts are good but the card leg failed. */
export interface EfsCarrierSnapshot {
  success?: boolean;
  carrierId?: string;
  totalBalance?: number;
  contracts?: Array<{ contractId?: string; description?: string; balance?: number }>;
  cards?: Array<{ cardNumber?: string; status?: string; type?: string; balance?: number }>;
  cardCount?: number;
  cardDetailError?: string | null;
  fetchedAt?: string;
}

export interface EfsListPayload<T> {
  success?: boolean;
  count?: number;
  data?: T[];
}

/** Collect every `*Error` field on a payload — what the per-section warning chips render from. */
export function partialErrors(payload: unknown): Array<{ field: string; message: string }> {
  if (typeof payload !== 'object' || payload === null) return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([key, value]) => /error$/i.test(key) && typeof value === 'string' && value.trim())
    .map(([key, value]) => ({ field: key, message: String(value) }));
}
