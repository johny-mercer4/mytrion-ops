import type { BlackboardPayload } from './blackboard.js';
import type { ContextNoMatch } from './turnContext.js';

/** Read only bounded, well-formed retrieval misses from the untrusted blackboard payload. */
export function knownNoMatchesFrom(board?: BlackboardPayload): ContextNoMatch[] {
  const raw = board?.facts['rag/knownNoMatch'];
  if (!Array.isArray(raw)) return [];
  const valid: ContextNoMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row['query'] !== 'string' || typeof row['scopeFingerprint'] !== 'string' || typeof row['at'] !== 'string') continue;
    if (!Number.isFinite(Date.parse(row['at']))) continue;
    valid.push({
      query: row['query'].slice(0, 1_000),
      scopeFingerprint: row['scopeFingerprint'].slice(0, 80),
      at: row['at'],
    });
  }
  return valid.slice(-24);
}
