import 'dotenv/config';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { closeDb, db } from '../src/db/client.js';
import { tenants } from '../src/db/schema/index.js';
import { logger } from '../src/lib/logger.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { userRepo } from '../src/repos/userRepo.js';
import type { Audience, Role } from '../src/types/tenantContext.js';

const DEFAULT_PASSWORD = 'changeme';

async function ensureTenant(id: string, name: string, audience: Audience): Promise<void> {
  await db.insert(tenants).values({ id, name, audience }).onConflictDoNothing();
  logger.info({ tenantId: id }, 'tenant ensured');
}

async function ensureUser(input: {
  email: string;
  role: Role;
  audience: Audience;
  tenantId: string;
  fullName: string;
}): Promise<void> {
  const existing = await userRepo.findByEmailForAuth(input.email, input.tenantId);
  if (existing) {
    logger.info({ email: input.email }, 'user already exists, skipping');
    return;
  }
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  await userRepo.create({
    tenantId: input.tenantId,
    email: input.email,
    passwordHash,
    role: input.role,
    audience: input.audience,
    fullName: input.fullName,
  });
  logger.info({ email: input.email, role: input.role }, 'user created');
}

async function main(): Promise<void> {
  await ensureTenant(DEFAULT_TENANT_ID, 'Octane', 'internal');
  await ensureTenant('partner-demo', 'Demo Fleet Co', 'partner');

  // Internal staff
  await ensureUser({
    email: 'admin@octane.com',
    role: 'admin',
    audience: 'internal',
    tenantId: DEFAULT_TENANT_ID,
    fullName: 'Octane Admin',
  });
  await ensureUser({
    email: 'ops@octane.com',
    role: 'ops',
    audience: 'internal',
    tenantId: DEFAULT_TENANT_ID,
    fullName: 'Octane Ops',
  });

  // Partner users (separate tenant)
  await ensureUser({
    email: 'fleet@demo.com',
    role: 'fleet_manager',
    audience: 'partner',
    tenantId: 'partner-demo',
    fullName: 'Demo Fleet Manager',
  });
  await ensureUser({
    email: 'driver@demo.com',
    role: 'driver',
    audience: 'partner',
    tenantId: 'partner-demo',
    fullName: 'Demo Driver',
  });

  logger.info(`Seed complete. Default password for all seeded users: "${DEFAULT_PASSWORD}"`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'seed failed');
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
