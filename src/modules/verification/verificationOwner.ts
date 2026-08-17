import { env } from '../../config/env.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';

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
