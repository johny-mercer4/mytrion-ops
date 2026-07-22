/**
 * The single authority for "which Mytrions may this worker use" — combines the per-profile default
 * (mytrion_profile_defaults) with the per-user override (worker_mytrion_access) into a final
 * {accessibleMytrions, homeMytrion, allDepartmentAccess, departments}. Injected into the verified
 * session context (authService.contextFromClaims) so backend RBAC (tool/agent/knowledge department
 * gates) is DB-driven, and surfaced to the client (/auth/me) so the UI stops guessing from profile
 * strings.
 *
 * Safety: an env-marker admin (resolveAllDepartmentAccess — ADMIN_PROFILE_MARKERS / ADMIN_USERS /
 * BYPASS_USERS) is PINNED to all-access; the DB can never lower it (no lockout). On any DB error
 * the resolver fails OPEN to the legacy profile→department derivation (never all-out lockout).
 * Result is TTL-cached per (tenant, zohoUser) with coalesced in-flight fetches.
 */
import { deriveWorkerDepartments, resolveAllDepartmentAccess } from '../../lib/department.js';
import { logger } from '../../lib/logger.js';
import {
  DEFAULT_PROFILE_SEED,
  departmentsForMytrions,
  MYTRION_DEPARTMENT,
  MYTRION_IDS,
  profileKeyOf,
  type MytrionId,
} from '../../lib/mytrions.js';
import { mytrionProfileDefaultsRepo, type MytrionProfileDefaultDto } from '../../repos/mytrionProfileDefaultsRepo.js';
import { workerMytrionAccessRepo, type WorkerMytrionAccessDto } from '../../repos/workerMytrionAccessRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface ResolvedAccess {
  accessibleMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  departments: string[];
  /** Zoho user ids this worker may "View as" (targeted impersonation grant; per-user override). */
  viewAsUserIds: string[];
}

export interface ResolveWorkerAccessInput {
  tenantId: string;
  zohoUserId: string;
  profileName?: string | null;
  zohoRole?: string | null;
  userName?: string | null;
}

const TTL_MS = 60_000;
/** A degraded (DB-error fallback) result is cached only briefly so recovery self-corrects fast. */
const DEGRADED_TTL_MS = 5_000;

interface CacheEntry {
  value: ResolvedAccess;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ResolvedAccess>>();
/**
 * Last CONFIDENTLY-resolved access per identity (no expiry). On a DB error we serve this instead of
 * the profile-substring fallback, so a DB-configured admin / a per-user override survives a transient
 * blip rather than being demoted to the legacy floor for the TTL.
 */
const lastGood = new Map<string, ResolvedAccess>();

interface ComputeResult {
  value: ResolvedAccess;
  /** true when the value is a DB-error fallback (not a confident resolution). */
  degraded: boolean;
}

/**
 * Key on the FULL resolved identity (not just tenant+user): a worker's profile/role is stable in
 * prod, but keying on it means a profile change refreshes access immediately instead of serving a
 * stale grant for the TTL. (Also keeps tests that reuse a userId across profiles from colliding.)
 */
function cacheKey(input: ResolveWorkerAccessInput): string {
  return JSON.stringify([
    input.tenantId,
    input.zohoUserId,
    input.profileName ?? '',
    input.zohoRole ?? '',
    input.userName ?? '',
  ]);
}

/** Minimal context for the resolver's own config reads (the repos use only ctx.tenantId). */
function internalCtx(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: 'system:access-resolver',
    audience: 'internal',
    role: 'admin',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: 'access-resolver',
  };
}

function subtract(ids: MytrionId[], denied: MytrionId[]): MytrionId[] {
  if (denied.length === 0) return ids;
  const deny = new Set(denied);
  return ids.filter((id) => !deny.has(id));
}

/** Home = the configured home if it's still accessible, else the sole accessible Mytrion, else none. */
function pickHome(home: MytrionId | null, accessible: MytrionId[]): MytrionId | null {
  if (home && accessible.includes(home)) return home;
  if (accessible.length === 1) return accessible[0] ?? null;
  return null;
}

/**
 * Pure (no I/O) combine of a worker's profile default + per-user override rows into their final
 * access. Factored out so a bulk caller (the admin listing endpoint) can fetch both tables ONCE
 * and combine in-memory for every user, instead of the per-user resolver's 2 DB round trips each —
 * see resolveBatch below.
 */
function combineAccess(
  input: ResolveWorkerAccessInput,
  pd: MytrionProfileDefaultDto | undefined,
  ov: WorkerMytrionAccessDto | undefined,
): ComputeResult {
  const envAdmin = resolveAllDepartmentAccess({
    profile: input.profileName ?? null,
    role: input.zohoRole ?? null,
    userName: input.userName ?? null,
  });
  const havePd = Boolean(pd && pd.active);
  const haveOv = Boolean(ov && ov.active);

  // UNMANAGED non-admin (no profile default AND no override configured) → preserve the legacy
  // profile-derived access. This makes the rollout non-breaking: nothing changes for a worker
  // until an admin explicitly configures their profile default or a per-user override. Admins
  // are still handled by the env floor in the compute path below.
  if (!envAdmin && !havePd && !haveOv) return { value: legacyAccess(input, false), degraded: false };

  // Step 1 — base. The active profile default, OR (when none) the legacy-derived FLOOR — so an
  // "inherit" override never resolves BELOW the un-configured baseline just because the profile
  // default row hasn't been seeded yet.
  const floor = havePd ? undefined : legacyAccess(input, false);
  let allowed: MytrionId[] = havePd && pd ? pd.allowedMytrions : (floor?.accessibleMytrions ?? []);
  let home: MytrionId | null = havePd && pd ? pd.homeMytrion : (floor?.homeMytrion ?? null);
  let allDept = havePd && pd ? pd.allDepartmentAccess : (floor?.allDepartmentAccess ?? false);

  // Step 2 — per-user override (replace allowed / subtract denied / override home + all-access).
  let denied: MytrionId[] = [];
  let viewAsUserIds: string[] = [];
  if (haveOv && ov) {
    if (ov.allowedMytrions != null) allowed = ov.allowedMytrions;
    denied = ov.deniedMytrions;
    if (ov.allDepartmentAccess != null) allDept = ov.allDepartmentAccess;
    if (ov.homeMytrion != null) home = ov.homeMytrion;
    viewAsUserIds = ov.viewAsUserIds;
  }

  // Step 3 — ADMIN FLOOR: an env-marker admin's all-access can never be lowered by the DB.
  if (envAdmin) allDept = true;

  // Step 4 — accessible set. env-marker admins are EXEMPT from the deny-list (the no-lockout
  // invariant must hold end-to-end: a stray deny can't empty a real admin's Mytrion list).
  const fullSet = allDept ? [...MYTRION_IDS] : allowed;
  const accessible = envAdmin ? fullSet : subtract(fullSet, denied);

  // `allDepartmentAccess: true` is a FULL bypass in every backend gate, so it can't express
  // "everything except X". A non-env-admin all-access grant WITH denies is downgraded to an
  // explicit department grant so the deny actually enforces (not just hidden in the UI list).
  const enforceableAllDept = allDept && (envAdmin || denied.length === 0);
  return {
    value: {
      accessibleMytrions: accessible,
      homeMytrion: pickHome(home, accessible),
      allDepartmentAccess: enforceableAllDept,
      departments: enforceableAllDept ? [] : departmentsForMytrions(accessible),
      viewAsUserIds,
    },
    degraded: false,
  };
}

async function computeAccess(input: ResolveWorkerAccessInput): Promise<ComputeResult> {
  const envAdmin = resolveAllDepartmentAccess({
    profile: input.profileName ?? null,
    role: input.zohoRole ?? null,
    userName: input.userName ?? null,
  });
  const ctx = internalCtx(input.tenantId);

  try {
    const pd =
      input.profileName != null
        ? await mytrionProfileDefaultsRepo.findByKey(ctx, profileKeyOf(input.profileName))
        : undefined;
    const ov = input.zohoUserId
      ? await workerMytrionAccessRepo.findByZohoUserId(ctx, input.zohoUserId)
      : undefined;
    return combineAccess(input, pd, ov);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), zohoUserId: input.zohoUserId },
      'mytrion access resolve failed — serving last-known-good / legacy fallback',
    );
    return { value: legacyAccess(input, envAdmin), degraded: true };
  }
}

/**
 * Fail-open fallback: env-admin → all; else profile/role substring → departments → Mytrions.
 * Customer Service Mytrion is NEVER granted here — Admin Profile Defaults / per-user override only.
 */
function legacyAccess(input: ResolveWorkerAccessInput, envAdmin: boolean): ResolvedAccess {
  if (envAdmin) {
    return { accessibleMytrions: [...MYTRION_IDS], homeMytrion: null, allDepartmentAccess: true, departments: [], viewAsUserIds: [] };
  }
  const departments = deriveWorkerDepartments(input.profileName ?? null, input.zohoRole ?? null).filter(
    (d) => d !== 'customer-service',
  );
  const deptSet = new Set(departments);
  const accessible = MYTRION_IDS.filter(
    (id) => id !== 'customer-service' && deptSet.has(MYTRION_DEPARTMENT[id]),
  );
  return {
    accessibleMytrions: accessible,
    homeMytrion: accessible.length === 1 ? (accessible[0] ?? null) : null,
    allDepartmentAccess: false,
    departments,
    viewAsUserIds: [],
  };
}

export const mytrionAccessService = {
  /** Resolve (TTL-cached) a worker's effective Mytrion access. Never throws — degrades to legacy. */
  async resolveWorkerAccess(input: ResolveWorkerAccessInput): Promise<ResolvedAccess> {
    const key = cacheKey(input);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const pending = inflight.get(key);
    if (pending) return pending;
    const p = computeAccess(input)
      .then(({ value, degraded }) => {
        if (!degraded) {
          lastGood.set(key, value);
          cache.set(key, { value, expires: Date.now() + TTL_MS });
          return value;
        }
        // DB error: prefer the last confidently-resolved grant (keeps a DB-configured admin / an
        // override intact through a blip); else serve the legacy fallback but only briefly so the
        // next request re-attempts the DB and self-corrects on recovery.
        const served = lastGood.get(key) ?? value;
        cache.set(key, { value: served, expires: Date.now() + DEGRADED_TTL_MS });
        return served;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  },

  /**
   * Resolve MANY workers' access at once from two bulk queries (profile defaults + overrides) —
   * used by the admin listing endpoint so listing N users costs O(1) DB round trips instead of the
   * per-user resolver's 2N (one profile-default + one override lookup per row). Also warms the
   * per-user TTL cache so a subsequent resolveWorkerAccess() for the same identity hits it.
   * Pass `prefetchedOverrides` when the caller already loaded the overrides list (e.g. to build its
   * own override-by-user map) to avoid fetching it twice.
   */
  async resolveBatch(
    tenantId: string,
    users: ResolveWorkerAccessInput[],
    prefetchedOverrides?: WorkerMytrionAccessDto[],
  ): Promise<Map<string, ResolvedAccess>> {
    const ctx = internalCtx(tenantId);
    const [profileDefaults, overrides] = await Promise.all([
      mytrionProfileDefaultsRepo.list(ctx),
      prefetchedOverrides ?? workerMytrionAccessRepo.list(ctx),
    ]);
    const pdByKey = new Map(profileDefaults.map((p) => [p.profileKey, p]));
    const ovById = new Map(overrides.map((o) => [o.zohoUserId, o]));

    const result = new Map<string, ResolvedAccess>();
    for (const input of users) {
      const pd = input.profileName != null ? pdByKey.get(profileKeyOf(input.profileName)) : undefined;
      const ov = ovById.get(input.zohoUserId);
      const { value, degraded } = combineAccess(input, pd, ov);
      if (!degraded) {
        const key = cacheKey(input);
        lastGood.set(key, value);
        cache.set(key, { value, expires: Date.now() + TTL_MS });
      }
      result.set(input.zohoUserId, value);
    }
    return result;
  },

  /**
   * Seed DEFAULT_PROFILE_SEED for a tenant iff it has no profile defaults yet (idempotent —
   * a tenant with ANY rows is left alone, so admin edits are never clobbered). Called at boot
   * (modules/access/bootstrap.ts) and by GET /admin/mytrion-access/profiles: unseeded tenants
   * previously fell to the legacy profile-substring floor, which locks out every profile whose
   * name doesn't contain its department ('Referral Standard Plus', 'Standard', …).
   * Returns the tenant's (possibly just-seeded) profile defaults.
   */
  async ensureProfileDefaultsSeeded(tenantId: string): Promise<MytrionProfileDefaultDto[]> {
    const ctx = internalCtx(tenantId);
    const existing = await mytrionProfileDefaultsRepo.list(ctx);
    if (existing.length === 0) {
      for (const seed of DEFAULT_PROFILE_SEED) {
        await mytrionProfileDefaultsRepo.upsert(ctx, {
          profileName: seed.profileName,
          allowedMytrions: seed.allowedMytrions,
          homeMytrion: seed.homeMytrion,
          allDepartmentAccess: seed.allDepartmentAccess,
        });
      }
      this.invalidateAll();
      return mytrionProfileDefaultsRepo.list(ctx);
    }
    // One-time product harden: strip leaked Standard → CS auto-grant on already-seeded tenants.
    await this.reconcileStandardNoCsGrant(tenantId);
    return mytrionProfileDefaultsRepo.list(ctx);
  },

  /**
   * Historical seed mapped Zoho profile "Standard" → CS Mytrion for every Standard user.
   * CS is Admin-controlled now — clear that default when it is still CS-only.
   */
  async reconcileStandardNoCsGrant(tenantId: string): Promise<void> {
    const ctx = internalCtx(tenantId);
    const standard = await mytrionProfileDefaultsRepo.findByKey(ctx, profileKeyOf('Standard'));
    if (!standard?.active) return;
    const onlyCs =
      standard.allowedMytrions.length === 1 && standard.allowedMytrions[0] === 'customer-service';
    if (!onlyCs) return;
    await mytrionProfileDefaultsRepo.upsert(ctx, {
      profileName: standard.profileName,
      allowedMytrions: [],
      homeMytrion: null,
      allDepartmentAccess: false,
      active: standard.active,
    });
    this.invalidateAll();
    logger.info({ tenantId }, 'mytrion access: cleared Standard → CS auto-grant (Admin-only CS)');
  },

  /** Drop a user's cached access across all identity variants (call after an override upsert). */
  invalidateUser(tenantId: string, zohoUserId: string): void {
    for (const map of [cache, lastGood]) {
      for (const key of map.keys()) {
        try {
          const parts = JSON.parse(key) as unknown[];
          if (parts[0] === tenantId && parts[1] === zohoUserId) map.delete(key);
        } catch {
          /* non-JSON key — ignore */
        }
      }
    }
  },

  /** Clear the whole cache (call after a profile-default change — it affects many users). */
  invalidateAll(): void {
    cache.clear();
    lastGood.clear();
  },
};
