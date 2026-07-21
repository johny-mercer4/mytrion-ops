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
 * never resolve worker access, so they're intentionally skipped.
 *
 * Fail-OPEN: a DB error (unreachable, or tables not yet migrated when DB_MIGRATE_ON_BOOT is off)
 * logs loudly and lets the server start — a crash-loop would take the whole API down, while an
 * unseeded tenant only degrades the three non-"sales"-substring profiles to the legacy floor
 * until the next boot or the first admin GET /admin/mytrion-access/profiles self-heals it.
 */
export async function seedMytrionAccessOnBoot(): Promise<void> {
  try {
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.audience, 'internal'), eq(tenants.status, 'active')));
    const tenantIds = new Set<string>([DEFAULT_TENANT_ID, ...rows.map((r) => r.id)]);
    for (const tenantId of tenantIds) {
      const profiles = await mytrionAccessService.ensureProfileDefaultsSeeded(tenantId);
      logger.info({ tenantId, profiles: profiles.length }, 'mytrion profile defaults ensured');
    }
  } catch (err) {
    logger.error(
      { err },
      'mytrion profile-default seeding FAILED — profiles without their department in the name ' +
        "('Referral Standard Plus', 'Standard Plus', 'Standard') fall to the legacy floor until " +
        'a restart or an admin opens Profile Defaults',
    );
  }
}
