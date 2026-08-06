import { logger } from '../../lib/logger.js';
import { knowledgeRepo } from '../../repos/knowledgeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { ingestDocument } from './ingestService.js';
import { buildPlatformCatalog } from './platformCatalog.js';

export interface PlatformSyncResult {
  ready: number;
  skipped: number;
  updated: number;
}

/** Deterministic allowlisted catalog sync. No environment secrets or unrestricted schemas enter content. */
export async function syncPlatformKnowledge(ctx: TenantContext): Promise<PlatformSyncResult> {
  const result: PlatformSyncResult = { ready: 0, skipped: 0, updated: 0 };
  for (const doc of buildPlatformCatalog()) {
    const previous = await knowledgeRepo.findLatestBySource(ctx, doc.source, 'platform');
    const ingested = await ingestDocument(ctx, {
      title: doc.title,
      content: doc.content,
      source: doc.source,
      mimeType: 'text/markdown',
      department: doc.department,
      origin: 'api',
      domain: 'platform',
      language: 'en',
      authorityClass: 'runtime-generated',
      owner: 'Horizon Platform',
      sourceVersion: doc.sourceVersion,
      sourceCommit: doc.sourceVersion,
      ...(previous ? { supersedesDocId: previous.id } : {}),
      metadata: doc.metadata,
      verified: true,
    });
    result[ingested.status] += 1;
  }
  await auditFromContext(ctx, {
    action: 'knowledge.platform_sync',
    status: 'ok',
    resourceType: 'knowledge_catalog',
    detail: { ...result },
  });
  logger.info(result, 'platform knowledge catalog synchronized');
  return result;
}
