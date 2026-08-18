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
 * Zoho ids out of an env value, which now holds a LIST.
 *
 * The desk has more than one credit agent, so `VERIFICATION_CASE_OWNER_ZOHO_USER_IDS` is comma
 * separated — and the deployed .env writes the same list under the older singular key, with a space
 * after the comma. Split on commas and whitespace, keep the order (it is the tie-break for routing),
 * drop duplicates, and reject anything non-numeric loudly rather than routing a case at a typo.
 */
export function parseZohoIdList(raw: string): string[] {
  const parts = raw.split(/[,\s]+/).map((p) => p.trim()).filter((p) => p.length > 0);
  const out: string[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(
        `[verification] VERIFICATION_CASE_OWNER_ZOHO_USER_IDS: "${part}" is not a numeric Zoho id`,
      );
    }
    if (!out.includes(part)) out.push(part);
  }
  return out;
}

/**
 * Every credit agent the desk can route to, in declaration order.
 *
 * Reads `_IDS` first, then the legacy singular `_ID` — the deployed .env still uses the old key and
 * had already been changed to hold two ids, which the previous single-id validator rejected outright:
 * `ingestVerificationDeals` calls this on its first line, so a comma in that value stopped every new
 * verification case from being created.
 *
 * Falls back to resolving `VERIFICATION_CASE_OWNER_NAME` from the CRM directory when neither key is
 * set, which is the original behaviour and keeps a fresh environment working with no config.
 */
export async function resolveVerificationCaseOwnerIds(): Promise<string[]> {
  const fromEnv =
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_IDS.trim() ||
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID.trim();
  if (fromEnv) {
    const ids = parseZohoIdList(fromEnv);
    if (ids.length > 0) return ids;
  }
  return [await resolveOwnerIdByName()];
}

/** The manager a case escalates to, or null when none is configured. */
export function resolveVerificationManagerId(): string | null {
  const raw = env.VERIFICATION_MANAGER_ID.trim();
  if (!raw) return null;
  const ids = parseZohoIdList(raw);
  return ids[0] ?? null;
}

/**
 * ONE credit agent, for the callers that still want a single fallback owner — the ingest's
 * "this Deal has no Sales owner" stand-in. Routing between agents is a separate decision and does
 * not belong behind a function that can only return one of them.
 */
export async function resolveVerificationCaseOwnerId(): Promise<string> {
  const ids = await resolveVerificationCaseOwnerIds();
  return ids[0] as string;
}

/** Resolve the configured owner NAME against the CRM directory. The no-config path. */
async function resolveOwnerIdByName(): Promise<string> {
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
