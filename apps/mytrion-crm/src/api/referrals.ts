/**
 * Manager Mytrion → Referrals card API. Reads the two Zoho referral modules (full field set) via the
 * manager-gated backend (`/v1/manager/referrals/:module`). Read-only. Rows are raw Zoho records
 * (field API names as-is); lookup fields (Parent_Referrer, Owner, …) arrive as `{ name, id }`.
 */
import { request } from './transport';

export interface ReferralField {
  apiName: string;
  label: string;
  type: string;
  options?: string[];
}

export type CrmRow = Record<string, unknown>;

export interface ReferralRecords {
  module: string;
  moduleKey: 'parents' | 'children';
  fields: ReferralField[];
  rows: CrmRow[];
  total: number;
  truncated: boolean;
}

// LEGACY department assertion — ignored for verified sessions (the server derives access from the
// session), kept only for the API-key / rollback path. Mirrors api/dataCenter.ts's DC_HEADERS.
const MGR_HEADERS = { 'x-department-access': 'management' } as const;

function getRecords(moduleKey: 'parents' | 'children', limit?: number): Promise<ReferralRecords> {
  return request('GET', `/manager/referrals/${moduleKey}`, {
    query: limit != null ? { limit } : {},
    headers: MGR_HEADERS,
  }) as Promise<ReferralRecords>;
}

/** Default server-side fetch limit is 200; pass `limit` to override (COQL-capped at 2000). */
export const listParentReferrers = (limit?: number): Promise<ReferralRecords> =>
  getRecords('parents', limit);
export const listChildReferrals = (limit?: number): Promise<ReferralRecords> =>
  getRecords('children', limit);

/** A curated Leads/Deals slice, with the Parent_Referrer/Child_Referrer lookups on each row. */
export interface LinkedRecords {
  module: string;
  fields: ReferralField[];
  rows: CrmRow[];
  total: number;
  truncated: boolean;
}

export interface ReferralAssociations {
  leads: LinkedRecords;
  deals: LinkedRecords;
}

/** Leads + Deals that reference any referral, for grouping under each parent/child (default 200). */
export const listReferralAssociations = (limit?: number): Promise<ReferralAssociations> =>
  request('GET', '/manager/referral-links', {
    query: limit != null ? { limit } : {},
    headers: MGR_HEADERS,
  }) as Promise<ReferralAssociations>;

export type ReferralBonusType =
  | 'gallons_legacy'
  | 'swipes_legacy'
  | 'gallons_parent'
  | 'gallons_child';

export interface ReferralCalculationPreview {
  parentId: string;
  childId: string;
  dealId: string;
  carrierId: number;
  parentName: string | null;
  childName: string | null;
  dealName: string | null;
  calculation: string;
  bonusType: ReferralBonusType;
  label: string;
  recipientKind: 'parent' | 'child';
  recipientName: string | null;
  fuelCodes: string[];
  recurring: boolean;
  rateUsd: number;
  thresholdGallons: number | null;
  periodGallons: number;
  periodSwipes: number;
  cumulativeGallons: number;
  amountUsd: string;
  payableAmountUsd: string;
  progressPct: number;
  state: 'tracking' | 'earned' | 'paid';
  ledgerStatus: 'calculated' | 'approved' | 'paid' | 'void' | null;
}

export interface ReferralWorkspaceSummary {
  parents: number;
  configuredParents: number;
  children: number;
  relatedDeals: number;
  connectedCarriers: number;
  needsDealLink: number;
  needsCalculation: number;
  earned: number;
  tracking: number;
  paid: number;
  payableAmountUsd: string;
}

export interface ReferralWorkspace {
  periodMonth: string;
  generatedAt: string;
  parents: ReferralRecords;
  children: ReferralRecords;
  associations: ReferralAssociations;
  previews: ReferralCalculationPreview[];
  unresolvedChildIds: string[];
  skippedNoCalculationChildIds: string[];
  summary: ReferralWorkspaceSummary;
}

/** One request for the full card grid, modal detail, and server-calculated MART preview. */
export const getReferralWorkspace = (periodMonth?: string): Promise<ReferralWorkspace> =>
  request('GET', '/manager/referrals/workspace', {
    query: periodMonth ? { period_month: periodMonth } : {},
    headers: MGR_HEADERS,
  }) as Promise<ReferralWorkspace>;
