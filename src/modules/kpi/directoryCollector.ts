import { listActiveUsersCached } from '../auth/actAsDirectory.js';
import { errorMessage } from '../../lib/errors.js';
import { kpiRepo } from '../../repos/kpiRepo.js';
import { kpiWorkerRepo } from '../../repos/kpiWorkerRepo.js';
import type { KpiWorker } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';

export async function syncKpiWorkerDirectory(
  ctx: TenantContext,
  bootstrapFrom?: Date,
): Promise<KpiWorker[]> {
  const run = await kpiRepo.startIngestion(ctx, {
    source: 'zoho_users',
    mode: 'directory',
  });
  try {
    const users = await listActiveUsersCached();
    const seen = new Set<string>();
    const existing = await kpiWorkerRepo.list(ctx);
    const byZoho = new Map(existing.map((worker) => [worker.zohoUserId, worker]));
    const eligibleIds = new Set(
      (await kpiWorkerRepo.list(ctx, true)).map((worker) => worker.id),
    );
    const enabledProfiles = await kpiWorkerRepo.enabledProfileNames(ctx);
    let changed = 0;
    for (const user of users) {
      seen.add(user.zohoUserId);
      const current = byZoho.get(user.zohoUserId);
      const profileName = user.profile?.trim() || null;
      const desiredEligible =
        profileName !== null &&
        enabledProfiles.has(profileName.replace(/\s+/g, ' ').toLowerCase());
      if (
        current &&
        current.displayName === (user.name?.trim() || null) &&
        current.email === (user.email?.trim() || null) &&
        current.currentProfileName === profileName &&
        current.currentRoleName === (user.role?.trim() || null) &&
        current.sourceActive &&
        eligibleIds.has(current.id) === desiredEligible
      ) {
        continue;
      }
      await kpiWorkerRepo.sync(ctx, {
        zohoUserId: user.zohoUserId,
        displayName: user.name,
        email: user.email,
        profileName: user.profile,
        roleName: user.role,
        active: true,
      });
      changed += 1;
    }
    const missing = await kpiWorkerRepo.markMissingInactive(ctx, seen);
    const backdated = bootstrapFrom
      ? await kpiWorkerRepo.backdateInitialMemberships(ctx, bootstrapFrom)
      : 0;
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: 'completed',
      recordsSeen: users.length,
      recordsWritten: changed + missing + backdated,
    });
    return kpiWorkerRepo.list(ctx, true);
  } catch (error) {
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: 'failed',
      recordsSeen: 0,
      recordsWritten: 0,
      error: errorMessage(error),
    });
    throw error;
  }
}
