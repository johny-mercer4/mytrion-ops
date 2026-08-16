/**
 * API tests mint short Zoho ids (`zoho:42`, `zoho:888`, …) with fake display names.
 * Real CRM user ids are 19-digit. Relabel the short ones so Audit Log never looks like a person.
 */
import { sql, type SQL } from 'drizzle-orm';
import { auditLog } from '../../db/schema/index.js';

export const CI_TEST_ACTOR_USER_ID = 'zoho:42';
export const CI_TEST_ACTOR_NAME = 'CI Test Admin';
/** Postgres regex — same rule as `isCiTestAuditActor`. */
export const CI_TEST_USER_ID_SQL = '^zoho:[0-9]{1,4}$';

const CI_TEST_USER_ID = /^zoho:\d{1,4}$/;
const CI_TEST_NAMES = new Set(['Robiya', 'Rep Riley', 'Admin Ann', 'Manager Mo']);

export function isCiTestAuditActor(userId: string | null | undefined): boolean {
  return Boolean(userId && CI_TEST_USER_ID.test(userId));
}

/** Include or exclude Vitest fixture actors (`zoho:42`, `zoho:888`, …). */
export function ciTestActorSql(include: boolean): SQL {
  const match = sql`${auditLog.userId} ~ ${CI_TEST_USER_ID_SQL}`;
  return include ? match : sql`(${auditLog.userId} IS NULL OR NOT (${match}))`;
}

export function displayAuditUserName(
  userId: string | null | undefined,
  userName: string | null | undefined,
): string | null {
  if (isCiTestAuditActor(userId)) return CI_TEST_ACTOR_NAME;
  if (!userId && userName && CI_TEST_NAMES.has(userName)) return CI_TEST_ACTOR_NAME;
  return userName ?? null;
}
