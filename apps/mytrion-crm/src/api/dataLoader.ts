import { request } from './transport';

export type BulkChangeOperation = 'insert' | 'update' | 'delete';
export type BulkChangeSnapshot = Record<string, unknown>;

export interface DataLoaderConfig {
  baseUrl: string | null;
  tables: string[];
}

export interface DataLoaderBatch {
  batchId: string;
  tableName: string;
  dbUser: string;
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  rowCount: number;
  createdAt: string;
  revertedAt: string | null;
}

export interface DataLoaderChange {
  id: string;
  tenantId: string;
  audience: string | null;
  batchId: string;
  tableName: string;
  rowPk: string;
  op: BulkChangeOperation;
  before: BulkChangeSnapshot | null;
  after: BulkChangeSnapshot | null;
  dbUser: string;
  revertedAt: string | null;
  revertedBy: string | null;
  createdAt: string;
}

export interface DataLoaderBatchesResponse {
  batches: DataLoaderBatch[];
  total: number;
  limit: number;
  offset: number;
}

export async function getDataLoaderConfig(): Promise<DataLoaderConfig> {
  return (await request('GET', '/admin/data-loader/config', {
    impersonate: false,
  })) as DataLoaderConfig;
}

export async function listDataLoaderBatches(
  limit: number,
  offset: number,
): Promise<DataLoaderBatchesResponse> {
  return (await request('GET', '/admin/data-loader/batches', {
    impersonate: false,
    query: { limit, offset },
  })) as DataLoaderBatchesResponse;
}

export async function getDataLoaderBatch(
  batchId: string,
): Promise<{ batchId: string; rows: DataLoaderChange[] }> {
  return (await request(
    'GET',
    `/admin/data-loader/batches/${encodeURIComponent(batchId)}`,
    { impersonate: false },
  )) as { batchId: string; rows: DataLoaderChange[] };
}

export async function revertDataLoaderBatch(
  batchId: string,
): Promise<{ batchId: string; rowCount: number; tables: string[] }> {
  return (await request(
    'POST',
    `/admin/data-loader/batches/${encodeURIComponent(batchId)}/revert`,
    { impersonate: false },
  )) as { batchId: string; rowCount: number; tables: string[] };
}

