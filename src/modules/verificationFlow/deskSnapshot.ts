/**
 * Broker snapshot for Phase 2 on the desk — the same warehouse read Sales uses to prefill.
 * Returns the match even when intake already has the values, so the reviewer can compare.
 */
import { findBrokerSnapshot } from '../../integrations/dwhBrokerSnapshot.js';
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import { NotFoundError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { withFlowSchemaGuard } from './applicationService.js';

export async function readDeskBrokerSnapshot(ctx: TenantContext, caseId: string) {
  return withFlowSchemaGuard(async () => {
    const row = await verificationFlowRepo.findById(ctx, caseId);
    if (!row) throw new NotFoundError('Verification case not found');
    const match = await findBrokerSnapshot({
      phones: [row.phone],
      dot: row.dot,
      email: row.email,
    });
    return { match };
  });
}
