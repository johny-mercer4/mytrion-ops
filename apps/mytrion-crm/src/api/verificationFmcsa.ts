/**
 * Verification Data Center → FMCSA (QCMobile) search.
 *
 * Own file because `verificationFlow.ts` is already over the house cap, and this read is not a
 * desk write. Shape mirrors `FmcsaCarrierLookup` on the API — the CRM must not invent fields the
 * register does not send (`mcNumber` is one of those).
 */
import { request } from './transport';

export type FmcsaSearchBy = 'dot' | 'mc' | 'name';
export type FmcsaFlag = 'yes' | 'no' | 'unknown';
export type FmcsaStatusVerdict = 'active' | 'inactive' | 'unknown';
export type FmcsaAuthorityVerdict = 'active' | 'none' | 'unknown';
export type FmcsaUnavailableReason =
  | 'not_configured'
  | 'blocked'
  | 'auth'
  | 'maintenance'
  | 'transport'
  | 'http';

export interface FmcsaAuthorityLine {
  raw: string | null;
  verdict: FmcsaAuthorityVerdict;
}

export interface FmcsaInsuranceLine {
  raw: string | null;
  dollars: number | null;
  onFile: boolean;
  required: FmcsaFlag;
  requiredDollars: number | null;
}

export interface FmcsaCarrierRow {
  dotNumber?: string;
  legalName?: string;
  dbaName?: string;
  ein?: string;
  statusCode?: string;
  status: FmcsaStatusVerdict;
  allowedToOperate: FmcsaFlag;
  oosDate?: string;
  authority: Record<'common' | 'contract' | 'broker', FmcsaAuthorityLine>;
  insurance: Record<'bipd' | 'bond' | 'cargo', FmcsaInsuranceLine>;
  carrierOperationCode?: string;
  carrierOperationDesc?: string;
  phyStreet?: string;
  phyCity?: string;
  phyState?: string;
  phyZipcode?: string;
  safetyRating?: string;
  driverOosRate?: number;
  vehicleOosRate?: number;
}

export interface FmcsaSearchResult {
  available: boolean;
  error: string | null;
  reason: FmcsaUnavailableReason | null;
  matchedOn: FmcsaSearchBy | null;
  carrier: FmcsaCarrierRow | null;
  candidates: FmcsaCarrierRow[];
  candidatesTruncated: boolean;
  notFound: boolean;
  retrievalDate: string | null;
}

export async function searchFmcsa(query: {
  by: FmcsaSearchBy;
  q: string;
}): Promise<FmcsaSearchResult> {
  return (await request('GET', '/verification/flow/fmcsa/search', {
    query: { by: query.by, q: query.q },
  })) as FmcsaSearchResult;
}
