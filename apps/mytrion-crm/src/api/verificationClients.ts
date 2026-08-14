/**
 * Verification Mytrion → "Existing clients" roster (`/v1/verification/roster*`).
 *
 * Distinct from `api/verification.ts` (the Sales redesign's "Verification Pipeline" tab — the
 * caller's own deal-clients + a mock compliance-stage snapshot, gated on `sales`). This is the
 * Verification Mytrion's own company-wide roster, gated on the `verification` department.
 */
import { request } from './transport';

/** `companyType` is `dim_company.billing_type` — see the backend module header for why. */
export interface VerificationClientRow {
  carrierId: string;
  companyName: string;
  companyType: string;
  paymentTerms: string;
  paymentDay: string;
  minimumRequiredBalance: number | null;
  billingCycleTag: string;
  isDebtor: boolean;
  billingCycle: string;
  /** Only meaningful when `paymentTerms === 'LOC'`. */
  creditLimit: number | null;
  creditScore: number | null;
  isActive: boolean;
  /** `dim_company.last_transaction_date` as yyyy-mm-dd. Null when the carrier has never swiped. */
  lastTransactionAt: string | null;
}

export interface VerificationClientDetail extends VerificationClientRow {
  contact: string;
  phone: string;
  email: string;
  agentName: string;
  agentEmail: string;
  dot: string;
  address: string;
  city: string;
  state: string;
  moneyCode: string;
  insuranceCoverage: string;
  creditsafeGrade: string;
  firstSwipeAt: string | null;
  lastTransactionAt: string | null;
}

export interface VerificationRosterResult {
  items: VerificationClientRow[];
  total: number;
}

export async function listVerificationRoster(signal?: AbortSignal): Promise<VerificationRosterResult> {
  const data = await request('GET', '/verification/roster', {
    ...(signal ? { signal } : {}),
  });
  return data as VerificationRosterResult;
}

export async function getVerificationClientDetail(
  carrierId: string,
  signal?: AbortSignal,
): Promise<VerificationClientDetail> {
  const data = await request('GET', `/verification/roster/${encodeURIComponent(carrierId)}`, {
    ...(signal ? { signal } : {}),
  });
  return data as VerificationClientDetail;
}
