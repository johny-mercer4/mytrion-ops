/**
 * Verification Data Center → Motus (Socrata) search.
 *
 * Own file next to `verificationFmcsa.ts`. Shape mirrors `MotusSearchResult` on the API.
 * Census is live; insurance and process agents are the frozen SODA feeds.
 */
import { request } from './transport';

export type MotusSearchBy = 'dot' | 'name';
export type MotusInsuranceStatus = 'active' | 'cancelled' | 'future' | 'stale' | 'superseded';

export interface MotusCensusDocket {
  prefix: string;
  number: string;
  statusCode: string | null;
  statusLabel: string | null;
}

export interface MotusCensusRecord {
  dotNumber: string;
  legalName: string | null;
  dbaName: string | null;
  statusCode: 'A' | 'I' | 'P' | null;
  statusLabel: string | null;
  carrierOperation: 'A' | 'B' | 'C' | null;
  carrierOperationLabel: string | null;
  powerUnits: number | null;
  totalDrivers: number | null;
  addDate: string | null;
  safetyRating: string | null;
  dockets: MotusCensusDocket[];
  address: Record<'street' | 'city' | 'state' | 'zip', string | null>;
  phone: string | null;
  fields?: Record<string, unknown>;
}

export interface MotusInsuranceFiling {
  docketNumber: string;
  formCode: string;
  formLabel: string | null;
  insurer: string | null;
  policyNo: string | null;
  transDate: string | null;
  effectiveDate: string;
  canclEffectiveDate: string | null;
  maxCoverageDollars: number | null;
  underlyingLimitDollars: number | null;
  status: MotusInsuranceStatus;
  fields?: Record<string, unknown>;
}

export interface MotusProcessAgent {
  docketNumber: string | null;
  agentName: string | null;
  attnTo: string | null;
  address: Record<'street' | 'city' | 'state' | 'country' | 'zip', string | null>;
  fields?: Record<string, unknown>;
}

export interface MotusInsuranceResult {
  available: boolean;
  error: string | null;
  frozen: true;
  dataAsOf: string;
  filings: MotusInsuranceFiling[];
}

export interface MotusProcessAgentResult {
  available: boolean;
  error: string | null;
  frozen: true;
  dataAsOf: string;
  agents: MotusProcessAgent[];
}

export interface MotusCensusSlice {
  available: boolean;
  error: string | null;
  record: MotusCensusRecord | null;
  records: MotusCensusRecord[];
  truncated: boolean;
}

export interface MotusSearchResult {
  available: boolean;
  error: string | null;
  matchedOn: MotusSearchBy | null;
  notFound: boolean;
  census: MotusCensusSlice;
  insurance: MotusInsuranceResult | null;
  processAgents: MotusProcessAgentResult | null;
}

export async function searchMotus(query: {
  by: MotusSearchBy;
  q: string;
}): Promise<MotusSearchResult> {
  return (await request('GET', '/verification/flow/motus/search', {
    query: { by: query.by, q: query.q },
  })) as MotusSearchResult;
}
