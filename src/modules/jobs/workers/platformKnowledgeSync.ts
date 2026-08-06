import { env } from '../../../config/env.js';
import { syncPlatformKnowledge } from '../../knowledge/platformSync.js';
import { buildSystemContext } from '../systemContext.js';

export async function runPlatformKnowledgeSync(): Promise<unknown> {
  if (!env.FF_PLATFORM_KNOWLEDGE) return { skipped: true, reason: 'FF_PLATFORM_KNOWLEDGE is off' };
  return syncPlatformKnowledge(buildSystemContext([], { allDepartmentAccess: true }));
}
