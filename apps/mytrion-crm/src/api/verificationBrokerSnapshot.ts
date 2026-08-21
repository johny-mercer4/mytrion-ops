/**
 * Verification Data Center → Broker Snapshot (DWH `stg_broker_snapshot`) search.
 *
 * Own file next to `verificationFmcsa.ts` / `verificationMotus.ts`. Shape mirrors
 * `BrokerSnapshotSearchResult` on the API. USDOT and owner name only — the table has no MC.
 */
import { request } from './transport';

export type BrokerSnapshotSearchBy = 'dot' | 'name';

export interface BrokerSnapshotRecord {
  id: string;
  dotNumber: string | null;
  ownerFullName: string | null;
  phoneNumber: string | null;
  email: string | null;
  physicalAddress: string | null;
  operatingStatus: string | null;
  powerUnits: number | null;
  truckSize: number | null;
  addDate: string | null;
  changeDate: string | null;
  isActive: boolean;
  fields?: Record<string, unknown>;
}

export interface SearchPagination {
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface BrokerSnapshotSearchResult {
  available: boolean;
  error: string | null;
  matchedOn: BrokerSnapshotSearchBy | null;
  notFound: boolean;
  truncated: boolean;
  pagination: SearchPagination;
  records: BrokerSnapshotRecord[];
}

export async function searchBrokerSnapshot(query: {
  by: BrokerSnapshotSearchBy;
  q: string;
  page?: number | undefined;
  pageSize?: number | undefined;
}): Promise<BrokerSnapshotSearchResult> {
  return (await request('GET', '/verification/flow/broker-snapshot/search', {
    query: { by: query.by, q: query.q, page: query.page, pageSize: query.pageSize },
  })) as BrokerSnapshotSearchResult;
}
