/** Knowledge-base admin API (the /v1/knowledge endpoints the RnD widget used). */
import { request } from './transport';

export type DocStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface KnowledgeDoc {
  id: string;
  title: string;
  departmentAccess: string | null;
  status: DocStatus;
  chunkCount: number | null;
  mimeType: string | null;
  source: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeStats {
  docs: number;
  chunks: number;
}

export interface DocChunk {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  hasEmbedding: boolean;
}

export interface IngestResult {
  docId: string;
  chunkCount: number;
  status: 'ready' | 'skipped' | 'updated' | string;
}

export interface RetrievedPassage {
  docId: string;
  chunkIndex: number;
  content: string;
  score: number;
}

export async function getStats(): Promise<KnowledgeStats> {
  return (await request('GET', '/knowledge/stats')) as KnowledgeStats;
}

export async function listDocs(
  opts: { limit?: number; offset?: number; department?: string } = {},
): Promise<{ docs: KnowledgeDoc[] }> {
  return (await request('GET', '/knowledge/docs', {
    query: { limit: opts.limit ?? 200, offset: opts.offset ?? 0, department: opts.department },
  })) as { docs: KnowledgeDoc[] };
}

export async function getDocChunks(
  docId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ docId: string; chunks: DocChunk[] }> {
  return (await request('GET', `/knowledge/docs/${encodeURIComponent(docId)}/chunks`, {
    query: { limit: opts.limit ?? 100, offset: opts.offset ?? 0 },
  })) as { docId: string; chunks: DocChunk[] };
}

/** Ingest one document (title + text content). Idempotent by content checksum. */
export async function embedDocument(input: {
  title: string;
  content: string;
  department?: string;
  mimeType?: string;
}): Promise<IngestResult> {
  return (await request('POST', '/knowledge/embed', {
    body: {
      title: input.title,
      content: input.content,
      source: 'mytrion-admin',
      ...(input.department ? { department: input.department } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    },
  })) as IngestResult;
}

export async function deleteDoc(
  docId: string,
): Promise<{ deleted: { id: string; title: string; chunkCount: number | null } }> {
  return (await request('POST', `/knowledge/docs/${encodeURIComponent(docId)}/delete`, {
    body: {},
  })) as { deleted: { id: string; title: string; chunkCount: number | null } };
}

/** Reset the doc's freshness clock (last_verified_at = now) after a human review. */
export async function verifyDoc(docId: string): Promise<{ verified: true; id: string }> {
  return (await request('POST', `/knowledge/docs/${encodeURIComponent(docId)}/verify`, {
    body: {},
  })) as { verified: true; id: string };
}

/** Semantic retrieval test (admin: allDepartments, or a single department filter). */
export async function queryKnowledge(input: {
  query: string;
  limit?: number;
  allDepartments?: boolean;
  departmentAccess?: string[];
}): Promise<{ passages: RetrievedPassage[] }> {
  return (await request('POST', '/knowledge/query', {
    body: {
      query: input.query,
      limit: input.limit ?? 8,
      ...(input.allDepartments !== undefined ? { allDepartments: input.allDepartments } : {}),
      ...(input.departmentAccess ? { departmentAccess: input.departmentAccess } : {}),
    },
  })) as { passages: RetrievedPassage[] };
}
