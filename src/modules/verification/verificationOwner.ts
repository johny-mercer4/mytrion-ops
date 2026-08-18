import { env } from '../../config/env.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { resolveActAsTarget } from '../auth/actAsDirectory.js';

export const VERIFICATION_CASE_OWNER_NAME = 'Sarvar Asqarov';
/** Alias used in ingest assignment + tests. The Zoho user id is resolved at runtime, not hardcoded. */
export const SARVAR = VERIFICATION_CASE_OWNER_NAME;

let cachedOwnerId: string | null = null;

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Zoho user id for the shared Verification case owner. Env override wins; otherwise we resolve
 * "Sarvar Asqarov" from CRM users and cache it for the process lifetime.
 */
export async function resolveVerificationCaseOwnerId(): Promise<string> {
  const fromEnv = env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID.trim();
  if (fromEnv) {
    if (!/^\d+$/.test(fromEnv)) {
      throw new Error('[verification] VERIFICATION_CASE_OWNER_ZOHO_USER_ID must be a numeric Zoho id');
    }
    return fromEnv;
  }
  if (cachedOwnerId) return cachedOwnerId;
  const target = normalizeName(VERIFICATION_CASE_OWNER_NAME);
  const users = await zohoCrm.listUsersForNameResolution();
  const matches = users.filter((u) => normalizeName(u.name ?? '') === target);
  if (matches.length === 0) {
    throw new Error(
      `[verification] could not resolve Zoho user "${VERIFICATION_CASE_OWNER_NAME}" — set VERIFICATION_CASE_OWNER_ZOHO_USER_ID`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `[verification] multiple Zoho users named "${VERIFICATION_CASE_OWNER_NAME}" — set VERIFICATION_CASE_OWNER_ZOHO_USER_ID`,
    );
  }
  const id = matches[0]?.zohoUserId;
  if (!id) {
    throw new Error(`[verification] Zoho user "${VERIFICATION_CASE_OWNER_NAME}" has no id`);
  }
  cachedOwnerId = id;
  return id;
}

export function resetVerificationOwnerCache(): void {
  cachedOwnerId = null;
}

/**
 * The Verification agent, for anything that has to NAME them — the desk's own screens.
 *
 * There is no per-case underwriter anywhere in the schema: `decided_by` is unwritten on every case
 * and every phase row, case events carry no actor, and `distribute_type` is `shared`. This one
 * configured agent is who the ingest notifies about every application and who the row falls back to
 * when a Deal arrives unowned, so they ARE the verification owner of every case.
 *
 * The name comes from the CRM directory for the CONFIGURED id rather than from
 * `VERIFICATION_CASE_OWNER_NAME`, because `VERIFICATION_CASE_OWNER_ZOHO_USER_ID` can point the desk
 * at somebody else and the constant would then be a stale label. The constant stays the fallback for
 * when the directory cannot be reached. Returns null rather than throwing: a desk screen that cannot
 * name its underwriter should still load.
 */
export async function resolveVerificationCaseOwner(): Promise<{
  zohoUserId: string;
  name: string;
} | null> {
  try {
    const zohoUserId = await resolveVerificationCaseOwnerId();
    const target = await resolveActAsTarget(zohoUserId).catch(() => null);
    return { zohoUserId, name: target?.name?.trim() || VERIFICATION_CASE_OWNER_NAME };
  } catch {
    return null;
  }
}
