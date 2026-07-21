/**
 * Boot-time Mytrion access seeding. Profile defaults used to be seeded lazily — only when an
 * admin first opened the Profile Defaults screen — so a fresh environment ran every worker on
 * the legacy profile-substring floor until then, locking out profiles whose names don't contain
 * their department ('Referral Standard Plus', 'Standard Plus', 'Standard'). Runs on every boot,
 * idempotent (a tenant with any rows is untouched).
 */
import { and, eq } from 'drizzle-orm';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { db } from '../../db/client.js';
import { tenants } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { mytrionAccessService } from './mytrionAccessService.js';

/**
 * Seed Mytrion profile defaults for every active internal tenant — always including 'octane',
 * which worker auth pins even when its tenants row was never inserted. Partner/customer tenants
 * never resolve worker access, so they're intentionally skipped. Fail-closed: a throw aborts
 * boot (this runs against the same DB migrations just succeeded on; an unseeded prod silently
 * locks out three sales profiles, which is worse than a restart loop that pages someone).
 */
export async function seedMytrionAccessOnBoot(): Promise<void> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.audience, 'internal'), eq(tenants.status, 'active')));
  const tenantIds = new Set<string>([DEFAULT_TENANT_ID, ...rows.map((r) => r.id)]);
  for (const tenantId of tenantIds) {
    const profiles = await mytrionAccessService.ensureProfileDefaultsSeeded(tenantId);
    logger.info({ tenantId, profiles: profiles.length }, 'mytrion profile defaults ensured');
  }
}
