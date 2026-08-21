import { auditFromContext } from './auditLogger.js';
import { auditRepo } from '../../repos/auditRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export async function scrubStoredTouchpointPans(
  ctx: TenantContext,
  options: { batchSize?: number; maxRows?: number } = {},
): Promise<number> {
  const batchSize = Math.min(Math.max(Math.trunc(options.batchSize ?? 500), 1), 1_000);
  const maxRows = Math.min(Math.max(Math.trunc(options.maxRows ?? 10_000), 1), 100_000);
  let scrubbed = 0;
  while (scrubbed < maxRows) {
    const changed = await auditRepo.scrubTouchpointCardNumbers(
      ctx,
      Math.min(batchSize, maxRows - scrubbed),
    );
    scrubbed += changed;
    if (changed < batchSize) break;
  }
  await auditFromContext(ctx, {
    action: 'admin.audit.touchpoint_pan_scrub',
    status: 'ok',
    resourceType: 'audit_log',
    detail: { scrubbedRows: scrubbed, boundedAt: maxRows },
  });
  return scrubbed;
}
