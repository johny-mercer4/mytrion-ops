/**
 * Sales Verification Pipeline (GET /v1/verification/*) — the agent's deal-clients (DWH, freshest
 * application date first) + a per-client compliance-pipeline snapshot. Owner-scoped server-side;
 * admins pass ?zoho_user_id (View-as). Pipeline data is mock this phase (no verification DB).
 */
import { request } from './transport';

const V_HEADERS = { 'x-department-access': 'sales' } as const;

export type VerificationClientStage = 'in_pipeline' | 'active' | 'closed';

export interface VerificationClient {
  dealId: string | null;
  carrierId: string;
  companyName: string;
  appFillDate: string | null;
  dealStage: string;
  classification: VerificationClientStage;
  creditScore: number | null;
  creditLimit: number | null;
  billingCycle: string | null;
  paymentTerms: string | null;
  paymentDay: string | null;
  minimumRequiredBalance: number | null;
  firstSwipeDate: string | null;
  lastTransactionDate: string | null;
  totalActiveCards: number;
  totalSwipedCards: number;
  activeCardsLast30Days: number;
  isActive: boolean;
  isLocSuspended: boolean;
  isDebtor: boolean;
  applicationId: string | null;
  dot: string | null;
}

export type PipelineStageStatus = 'done' | 'failed' | 'skipped' | 'pending' | 'not_started';
export interface PipelineStage {
  id: string;
  order: number;
  label: string;
  status: PipelineStageStatus;
  detail?: string;
}
export type PipelineOutcome = 'prepaid' | 'loc' | 'rejected' | 'undecided';
export interface PipelineDecision {
  outcome: PipelineOutcome;
  creditScore?: number;
  approvedLimit?: number;
  billingCycle?: string;
  reason?: string;
}
export interface PipelineSnapshot {
  stages: PipelineStage[];
  decision: PipelineDecision;
  source: 'mock' | 'credit_platform';
}

/** The caller's deal-clients (admins may target an agent via ?zoho_user_id, honoured server-side). */
export async function getVerificationClients(zohoUserId?: string): Promise<VerificationClient[]> {
  const res = (await request('GET', '/verification/clients', {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: V_HEADERS,
  })) as { clients?: VerificationClient[] };
  return res.clients ?? [];
}

/** One client's 9-stage pipeline + decision. Pass the identity keys the deal carries. */
export async function getPipeline(keys: {
  dealId?: string | null;
  carrierId?: string | null;
  applicationId?: string | null;
  dot?: string | null;
}): Promise<PipelineSnapshot | null> {
  const query: Record<string, string> = {};
  if (keys.dealId) query.dealId = keys.dealId;
  if (keys.carrierId) query.carrierId = keys.carrierId;
  if (keys.applicationId) query.applicationId = keys.applicationId;
  if (keys.dot) query.dot = keys.dot;
  const res = (await request('GET', '/verification/pipeline', {
    query,
    headers: V_HEADERS,
  })) as { snapshot?: PipelineSnapshot | null };
  return res.snapshot ?? null;
}
