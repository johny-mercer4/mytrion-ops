/**
 * Server-side verification for admin "act as agent" impersonation. The ONLY thing the client
 * chooses is WHO to act as (x-act-as-zoho-user-id); the target's real name/profile/role come
 * from the CRM users directory, so a forged x-act-as-profile header can never mint elevated
 * authority. The directory is cached (ACT_AS_DIRECTORY_TTL_MS) via the shared token-provider
 * pattern — one CRM call per TTL window, coalesced across concurrent requests. Fail-closed:
 * an unknown/inactive target or an unreachable CRM rejects the impersonation.
 */
import { env } from '../../config/env.js';
import { createTokenProvider, type TokenProvider } from '../../integrations/tokenCache.js';
import { listActiveUsers, type CrmUser } from '../../integrations/zohoCrm.js';

let provider: TokenProvider<Map<string, CrmUser>> | null = null;

function directory(): TokenProvider<Map<string, CrmUser>> {
  if (!provider) {
    provider = createTokenProvider({
      ttlMs: env.ACT_AS_DIRECTORY_TTL_MS,
      fetch: async () => new Map((await listActiveUsers()).map((u) => [u.zohoUserId, u])),
    });
  }
  return provider;
}

/** The verified CRM record for an act-as target, or null when no active user matches. */
export async function resolveActAsTarget(zohoUserId: string): Promise<CrmUser | null> {
  const users = await directory().get();
  return users.get(zohoUserId) ?? null;
}

/**
 * The full active-users roster, TTL-cached via the same provider as resolveActAsTarget — used by
 * the admin "User Management" listing so it doesn't re-fetch all 5 paginated CRM pages (the
 * slowest part of that request) on every load.
 */
export async function listActiveUsersCached(): Promise<CrmUser[]> {
  const users = await directory().get();
  return Array.from(users.values());
}

/** For tests: drop the cached directory so the next call re-fetches. */
export function clearActAsDirectory(): void {
  provider?.clear();
  provider = null;
}
