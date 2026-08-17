/**
 * Decision Desk parity helpers for Verification cases: offer fields, Plaid URL, SLA, owner scope.
 * Desk stale threshold is MANUAL_REVIEW_STALE_MINUTES (default 30) — claimed/in-progress and idle
 * that long. Copied here; do not invent a second policy.
 */
import type { TenantContext } from '../../types/tenantContext.js';

export const MANUAL_REVIEW_STALE_MINUTES = 30;

export const VERIFICATION_OWNER_SCOPES = ['unclaimed', 'mine', 'others'] as const;
export type VerificationOwnerScope = (typeof VERIFICATION_OWNER_SCOPES)[number];

export const CASE_EXPORT_COLUMNS = [
  'Company',
  'Zoho id',
  'DOT',
  'Status',
  'Queue',
  'Owner',
  'Limit',
  'Payment',
  'Cycle',
] as const;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function txt(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function creditPlatformActor(ctx: TenantContext): string {
  const name = (ctx.userName || '').trim();
  if (name) return name;
  const id = (ctx.userId || '').replace(/^zoho:/, '').trim();
  return id || 'verification-mytrion';
}

export function normalizeQueueOwner(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

export function ownerMatchesViewer(
  owner: string | null | undefined,
  viewer: string | null | undefined,
): boolean {
  const left = normalizeQueueOwner(owner);
  const right = normalizeQueueOwner(viewer);
  return Boolean(left && right && left === right);
}

export function extractOfferFields(result: Record<string, unknown>): {
  approvedLimit: string | null;
  paymentType: string | null;
  billingCycle: string | null;
} {
  const manual = rec(result.manual_review);
  const resolution = rec(result.manual_review_resolution ?? manual.resolution);
  const summary = rec(result.summary);
  const limit = txt(resolution.approved_limit || result.approved_limit || summary.approved_limit || manual.approved_limit);
  const payment = txt(resolution.payment_type || result.payment_type || summary.payment_type || manual.payment_type);
  const cycle = txt(resolution.billing_cycle || result.billing_cycle || summary.billing_cycle || manual.billing_cycle);
  return {
    approvedLimit: limit || null,
    paymentType: payment || null,
    billingCycle: cycle || null,
  };
}

export function extractPlaidMode(result: Record<string, unknown>): string | null {
  const flow = rec(rec(result.manual_review).stage_flow);
  const mode = txt(flow.plaid_mode || result.plaid_mode);
  return mode || null;
}

/** Desk hides /api/v1/plaid/link/ tracking redirects — only the hosted Plaid URL is copyable. */
export function hostedPlaidLink(url: string | null | undefined): string | null {
  const value = txt(url);
  if (!value || /\/api\/v1\/plaid\/link\//.test(value)) return null;
  return value;
}

export function asDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function caseIdleMinutes(input: {
  cpReviewUpdatedAt?: Date | string | null;
  cpClaimedAt?: Date | string | null;
  lastSyncedAt?: Date | string | null;
  createdAt?: Date | string | null;
  now?: Date;
}): number {
  const stamp =
    asDate(input.cpReviewUpdatedAt) ??
    asDate(input.cpClaimedAt) ??
    asDate(input.lastSyncedAt) ??
    asDate(input.createdAt);
  if (!stamp) return 0;
  const now = input.now ?? new Date();
  return Math.max(0, Math.floor((now.getTime() - stamp.getTime()) / 60_000));
}

export function caseSla(input: {
  cpOwnerUsername?: string | null;
  cpReviewUpdatedAt?: Date | string | null;
  cpClaimedAt?: Date | string | null;
  lastSyncedAt?: Date | string | null;
  createdAt?: Date | string | null;
  now?: Date;
}): { stale: boolean; idleMinutes: number; label: string } {
  const claimed = Boolean(normalizeQueueOwner(input.cpOwnerUsername));
  const idleMinutes = caseIdleMinutes(input);
  const stale = claimed && idleMinutes >= MANUAL_REVIEW_STALE_MINUTES;
  if (!claimed) return { stale: false, idleMinutes, label: 'Unclaimed' };
  if (stale) {
    return { stale: true, idleMinutes, label: idleMinutes >= 60 ? `Stale · ${Math.floor(idleMinutes / 60)}h` : `Stale · ${idleMinutes}m` };
  }
  return {
    stale: false,
    idleMinutes,
    label: idleMinutes < 60 ? `Updated ${idleMinutes}m ago` : `Updated ${Math.floor(idleMinutes / 60)}h ago`,
  };
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildCasesCsv(
  rows: Array<{
    companyName: string | null;
    zohoApplicationId: string | null;
    /** Nullable since 0121 — a sales-originated application has no Zoho Deal. */
    zohoDealId: string | null;
    dot: string | null;
    status: string;
    distributeType: string;
    cpOwnerUsername: string | null;
    ownerName: string;
    approvedLimit: string | null;
    paymentType: string | null;
    billingCycle: string | null;
  }>,
): string {
  const lines = [CASE_EXPORT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.companyName ?? '',
        // Both are nullable now; the cells are String()-ed below, so a bare null would export the
        // literal text "null" into the analyst's spreadsheet.
        row.zohoApplicationId || row.zohoDealId || '',
        row.dot ?? '',
        row.status,
        row.distributeType === 'shared' ? 'Shared' : 'Personal',
        row.cpOwnerUsername || row.ownerName,
        row.approvedLimit ?? '',
        row.paymentType ?? '',
        row.billingCycle ?? '',
      ]
        .map((cell) => csvEscape(String(cell)))
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
