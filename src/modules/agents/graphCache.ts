/**
 * Compiled-agent cache. Compiling a manifest into a deepagents/LangGraph graph is expensive —
 * zodToJsonSchema per tool, Composio tool fetches over HTTP, and createDeepAgent graph assembly —
 * and it was happening on EVERY turn (for admins in orchestrator mode, all 10 subagents each turn).
 * The compiled graph has no per-turn mutable state: budget, tracker, abort signal and thread_id are
 * all passed at streamEvents() call time, and per-run bookkeeping is read from AsyncLocalStorage. So
 * the same graph object can be safely reused across turns AND concurrent requests.
 *
 * SECURITY — the graph bakes the caller's NARROWED identity into each tool closure (dispatch
 * authority). Therefore the cache key MUST encode every identity/authority/VIEW field, so two
 * different callers (or the same caller with a different department view / act-as identity) can never
 * share a graph. Only `requestId` is excluded — it is ephemeral and is re-sourced from the run
 * context at dispatch time (see agentTools.ts), so a reused graph never stamps a stale requestId on
 * audit rows. `actingAgent` is excluded too: it is set per-child by narrowContext, not on the caller.
 *
 * Entries expire (TTL) so Composio tool lists / manifest changes are picked up without a restart,
 * and the map is size-bounded (LRU-ish: oldest inserted evicted first) to cap memory.
 */
import { env } from '../../config/env.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** Fields excluded from the identity signature: ephemeral (requestId) or per-child (actingAgent). */
type IdentityKeyInput = Omit<TenantContext, 'requestId' | 'actingAgent'>;

/**
 * A stable, collision-free signature of everything that affects the compiled graph's identity,
 * authority, and tool/RAG visibility. Arrays are sorted so key order never changes the signature.
 */
export function identitySignature(ctx: TenantContext): string {
  const view: IdentityKeyInput & { requestId?: never; actingAgent?: never } = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    audience: ctx.audience,
    role: ctx.role,
    scopes: [...ctx.scopes].sort(),
    departments: [...ctx.departments].sort(),
    allDepartmentAccess: ctx.allDepartmentAccess,
    ...(ctx.bypassRbac !== undefined ? { bypassRbac: ctx.bypassRbac } : {}),
    ...(ctx.profiles ? { profiles: [...ctx.profiles].sort() } : {}),
    ...(ctx.callerRole !== undefined ? { callerRole: ctx.callerRole } : {}),
    ...(ctx.userName !== undefined ? { userName: ctx.userName } : {}),
    ...(ctx.email !== undefined ? { email: ctx.email } : {}),
    ...(ctx.sessionVerified !== undefined ? { sessionVerified: ctx.sessionVerified } : {}),
    ...(ctx.impersonatorUserId !== undefined ? { impersonatorUserId: ctx.impersonatorUserId } : {}),
    ...(ctx.client ? { client: ctx.client } : {}),
  };
  return JSON.stringify(view);
}

interface Entry<T> {
  value: Promise<T>;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 256;
const cache = new Map<string, Entry<unknown>>();

/**
 * Return the cached compiled graph for `key`, or build+cache it. The in-flight PROMISE is cached so
 * concurrent callers for the same key share one build; a failed build is evicted so the next call
 * retries. No-op passthrough (always builds) when FF_AGENT_GRAPH_CACHE is off.
 */
export async function getCachedAgent<T>(key: string, build: () => Promise<T>): Promise<T> {
  if (!env.FF_AGENT_GRAPH_CACHE) return build();

  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    // Refresh recency for LRU eviction order.
    cache.delete(key);
    cache.set(key, hit);
    return hit.value as Promise<T>;
  }
  if (hit) cache.delete(key); // expired

  const value = build().catch((err) => {
    // Don't leave a rejected promise cached — the next turn should try again.
    if (cache.get(key)?.value === (value as Promise<unknown>)) cache.delete(key);
    throw err;
  });
  cache.set(key, { value, expiresAt: now + TTL_MS });

  // Bound memory: evict the oldest inserted entries beyond the cap.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value as Promise<T>;
}

/** Clear the cache (tests + a manual "pick up manifest/flag changes now" hook). */
export function resetAgentGraphCache(): void {
  cache.clear();
}

/** Current entry count — for tests/metrics. */
export function agentGraphCacheSize(): number {
  return cache.size;
}
