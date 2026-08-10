/**
 * The single authority for "which Mytrions may this worker use" — combines the per-profile default
 * (mytrion_profile_defaults), per-role default (mytrion_role_defaults), and per-user override
 * (worker_mytrion_access) into a final {accessibleMytrions, homeMytrion, allDepartmentAccess,
 * departments}. Injected into the verified session context (authService.contextFromClaims) so
 * backend RBAC (tool/agent/knowledge department gates) is DB-driven, and surfaced to the client
 * (/auth/me) so the UI stops guessing from profile strings.
 *
 * Layering: profile default if set, else legacy floor → role default (UNION grants / OR all-dept /
 * home overlay) → per-user override (replace / deny) → env-admin pin. Admin Profile/Role Defaults
 * are the control plane; the legacy floor only covers Zoho profiles not yet configured in Admin.
 *
 * Per-Mytrion modes (read|full): env-admin / allDept → all full; else user explicit mode wins;
 * else role mode; else full (profile grants are implicit full). Mode does not affect entry.
 *
 * Safety / no-lockout: only the ENV BREAK-GLASS list (ADMIN_USERS / BYPASS_USERS — named users in
 * server config, not editable from the app) is pinned to all-access and exempt from denies. An
 * ADMIN_PROFILE_MARKERS profile/role ("Administrator", "ceo") still grants all-access BY DEFAULT,
 * but that default is now overridable from Admin → User Management, because otherwise every
 * Administrator-profile user was silently unmanageable: their override was computed and then thrown
 * away, so the UI reported a saved grant the resolver ignored. The route layer refuses to save the
 * override that would remove the LAST all-access user, which is what actually prevents a lockout.
 * On any DB error the resolver fails OPEN to the legacy profile→department derivation.
 * Result is TTL-cached per (tenant, zohoUser) with coalesced in-flight fetches.
 */
import {
  deriveWorkerDepartments,
  isAdminUser,
  isBypassUser,
  resolveAllDepartmentAccess,
} from '../../lib/department.js';
import { logger } from '../../lib/logger.js';
import {
  DEFAULT_PROFILE_SEED,
  departmentsForMytrions,
  MYTRION_DEPARTMENT,
  MYTRION_IDS,
  profileKeyOf,
  roleKeyOf,
  type MytrionAccessMode,
  type MytrionAccessModes,
  type MytrionId,
} from '../../lib/mytrions.js';
import { mytrionProfileDefaultsRepo, type MytrionProfileDefaultDto } from '../../repos/mytrionProfileDefaultsRepo.js';
import { mytrionRoleDefaultsRepo, type MytrionRoleDefaultDto } from '../../repos/mytrionRoleDefaultsRepo.js';
import { workerMytrionAccessRepo, type WorkerMytrionAccessDto } from '../../repos/workerMytrionAccessRepo.js';
import {
  mytrionPermissionSetAssignmentsRepo,
  mytrionPermissionSetsRepo,
  type MytrionPermissionSetDto,
  type TabGrants,
} from '../../repos/mytrionPermissionSetsRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface ResolvedAccess {
  accessibleMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  departments: string[];
  /** Zoho user ids this worker may "View as" (targeted impersonation grant; per-user override). */
  viewAsUserIds: string[];
  /** Effective read|full per accessible Mytrion (omitted ids treated as full). */
  mytrionAccessModes: MytrionAccessModes;
  /**
   * Per-Mytrion visible tab whitelist, from permission sets. A Mytrion ABSENT is UNRESTRICTED —
   * every tab it has, including ones added after the grant was written.
   *
   * UI GATING ONLY. No backend route reads this, and it is deliberately NOT put on TenantContext:
   * doing so would invite a `requireTab` guard reading a field whose vocabulary lives in the client.
   * The security boundary stays at Mytrion + read/full.
   */
  mytrionTabGrants: TabGrants;
}

/** True when the worker may perform write actions in this Mytrion (admins always can). */
export function canWriteMytrion(
  access: Pick<ResolvedAccess, 'allDepartmentAccess' | 'accessibleMytrions' | 'mytrionAccessModes'>,
  id: MytrionId,
): boolean {
  if (access.allDepartmentAccess) return true;
  if (!access.accessibleMytrions.includes(id)) return false;
  return access.mytrionAccessModes[id] !== 'read';
}

function resolveModes(
  accessible: MytrionId[],
  allDept: boolean,
  roleModes: MytrionAccessModes,
  userModes: MytrionAccessModes,
  sets: readonly MytrionPermissionSetDto[] = [],
): MytrionAccessModes {
  if (allDept) {
    const out: MytrionAccessModes = {};
    for (const id of accessible) out[id] = 'full';
    return out;
  }
  /**
   * MOST PERMISSIVE WINS. Permission sets are additive, Salesforce-style: an explicit `full` from a
   * set beats a `read` on any other layer, including a per-user override.
   *
   * The alternative — per-user always wins — makes "assign Bob the Billing Full Ops set" a silent
   * no-op whenever Bob happens to carry an old override row, with no feedback anywhere. To restrict
   * someone you remove the set from them, which is how Salesforce works too.
   */
  const setFull = new Set<MytrionId>();
  const setRead = new Set<MytrionId>();
  for (const set of sets) {
    for (const id of set.allowedMytrions) {
      if (set.mytrionAccessModes[id] === 'full') setFull.add(id);
      else setRead.add(id);
    }
  }

  const out: MytrionAccessModes = {};
  for (const id of accessible) {
    if (setFull.has(id)) {
      out[id] = 'full';
      continue;
    }
    const fromUser = userModes[id];
    const fromRole = roleModes[id];
    const fromSet: MytrionAccessMode | undefined = setRead.has(id) ? 'read' : undefined;
    const mode: MytrionAccessMode = fromUser ?? fromRole ?? fromSet ?? 'full';
    out[id] = mode;
  }
  return out;
}

/**
 * Union the tab scopes for each granted Mytrion.
 *
 * If ANY contributing layer granted the Mytrion WITHOUT a tab scope, the result is unscoped and the
 * key is omitted entirely. The three legacy layers are always unscoped — they have no tab column —
 * so a Mytrion also granted by a profile default is unscoped no matter what a set says.
 *
 * That is the honest consequence of additivity and it WILL surprise people ("I scoped them to Ledger
 * and they still see everything"). It is not hidden: the admin effective-access view names the layer
 * that defeated the scope and offers to narrow it. The alternative — any scoped source becomes a
 * ceiling — reintroduces the non-expressible "everything except X" trap that `enforceableAllDept`
 * already documents a workaround for.
 */
function resolveTabGrants(
  accessible: MytrionId[],
  legacyGranted: readonly MytrionId[],
  sets: readonly MytrionPermissionSetDto[],
): TabGrants {
  const out: TabGrants = {};
  const unscoped = new Set<MytrionId>(legacyGranted);
  const scoped = new Map<MytrionId, Set<string>>();

  for (const set of sets) {
    for (const id of set.allowedMytrions) {
      const tabs = set.tabGrants[id];
      if (tabs === undefined) {
        unscoped.add(id);
        continue;
      }
      const bucket = scoped.get(id) ?? new Set<string>();
      for (const key of tabs) bucket.add(key);
      scoped.set(id, bucket);
    }
  }

  for (const id of accessible) {
    if (unscoped.has(id)) continue;
    const bucket = scoped.get(id);
    if (bucket) out[id] = [...bucket];
  }
  return out;
}

export interface ResolveWorkerAccessInput {
  tenantId: string;
  zohoUserId: string;
  profileName?: string | null;
  zohoRole?: string | null;
  userName?: string | null;
}

/**
 * Short on purpose. Admin saves DO invalidate this cache directly, but that only covers the process
 * that handled the save — any other worker/instance keeps serving its own copy until expiry, which
 * is one of the ways an access edit appeared not to apply. 10s keeps the read cheap while bounding
 * how long a stale grant can survive anywhere in the fleet.
 */
const TTL_MS = 10_000;
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

/**
 * The active sets a worker actually holds.
 *
 * There are no foreign keys (house rule), so an assignment can outlive its set and an inactive set
 * can still have live assignments. Both are silently skipped rather than treated as an error — an
 * orphan must never be able to fail a login.
 */
function filterAssignedSets(
  allSets: readonly MytrionPermissionSetDto[],
  assignments: readonly { permissionSetId: string }[],
): MytrionPermissionSetDto[] {
  if (assignments.length === 0) return [];
  const held = new Set(assignments.map((a) => a.permissionSetId));
  return allSets.filter((s) => held.has(s.id) && s.active);
}

function unionMytrions(a: MytrionId[], b: MytrionId[]): MytrionId[] {
  const out: MytrionId[] = [];
  const seen = new Set<MytrionId>();
  for (const id of [...a, ...b]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Home = the configured home if it's still accessible, else the sole accessible Mytrion, else none. */
function pickHome(home: MytrionId | null, accessible: MytrionId[]): MytrionId | null {
  if (home && accessible.includes(home)) return home;
  if (accessible.length === 1) return accessible[0] ?? null;
  return null;
}

/**
 * Pure (no I/O) combine of profile default + role default + per-user override into final access.
 * Factored out so a bulk caller (the admin listing endpoint) can fetch tables ONCE and combine
 * in-memory for every user — see resolveBatch below.
 */
function combineAccess(
  input: ResolveWorkerAccessInput,
  pd: MytrionProfileDefaultDto | undefined,
  rd: MytrionRoleDefaultDto | undefined,
  ov: WorkerMytrionAccessDto | undefined,
  /** ALREADY filtered to this worker's active assignments — keeps this function pure. */
  sets: readonly MytrionPermissionSetDto[] = [],
): ComputeResult {
  // Marker admin = all-access by DEFAULT (a baseline the DB may lower).
  const markerAdmin = resolveAllDepartmentAccess({
    profile: input.profileName ?? null,
    role: input.zohoRole ?? null,
    userName: input.userName ?? null,
  });
  // Break-glass = named in server env. Immovable, because it is the recovery path if an admin
  // mis-configures themselves out of the app; it cannot be edited from inside the app.
  const breakGlass = isAdminUser(input.userName ?? null) || isBypassUser(input.userName ?? null);
  const havePd = Boolean(pd && pd.active);
  const haveRd = Boolean(rd && rd.active);
  const haveOv = Boolean(ov && ov.active);

  // UNMANAGED non-admin (no profile / role default AND no override) → legacy profile-derived
  // access so rollout stays non-breaking until an admin configures something.
  // A set counts as being managed: assigning one to an otherwise-unconfigured worker has to grant
  // something, or the whole feature is invisible for exactly the people it is easiest to onboard.
  if (!markerAdmin && !havePd && !haveRd && !haveOv && sets.length === 0) {
    return { value: legacyAccess(input, false), degraded: false };
  }

  // Step 1 — base grant.
  // Profile default (Admin → Profile Defaults) wins as the starting set when present.
  // Without a profile row, keep the legacy profile/role substring floor — Role Defaults and
  // per-user overrides layer on top. Role Defaults must not wipe unconfigured profiles to []
  // (that locked Sales users out of the app when any role default existed).
  let allowed: MytrionId[] = [];
  let home: MytrionId | null = null;
  let allDept = false;
  if (havePd && pd) {
    allowed = pd.allowedMytrions;
    home = pd.homeMytrion;
    allDept = pd.allDepartmentAccess;
  } else {
    const floor = legacyAccess(input, false);
    allowed = floor.accessibleMytrions;
    home = floor.homeMytrion;
    allDept = floor.allDepartmentAccess;
  }

  // Step 2 — role default overlays grants (UNION) and can raise all-dept / set home.
  // Particular Mytrion on a role = full access to that Mytrion (department 1:1 via mapping below).
  if (haveRd && rd) {
    if (rd.allDepartmentAccess) allDept = true;
    else allowed = unionMytrions(allowed, rd.allowedMytrions);
    if (rd.homeMytrion != null) home = rd.homeMytrion;
  }

  // Step 2.5 — MARKER FLOOR: a profile/role default must not silently strip an Administrator; only
  // the explicit per-user override in Step 3 may lower them. Without this, adding any profile-default
  // row for "Administrator" would quietly demote every admin in the org.
  if (markerAdmin) allDept = true;

  // Step 3 — per-user override (replace allowed / subtract denied / override home + all-access).
  let denied: MytrionId[] = [];
  let viewAsUserIds: string[] = [];
  let userModes: MytrionAccessModes = {};
  if (haveOv && ov) {
    if (ov.allowedMytrions != null) allowed = ov.allowedMytrions;
    denied = ov.deniedMytrions;
    if (ov.allDepartmentAccess != null) allDept = ov.allDepartmentAccess;
    if (ov.homeMytrion != null) home = ov.homeMytrion;
    viewAsUserIds = ov.viewAsUserIds;
    userModes = ov.mytrionAccessModes ?? {};
  }

  /**
   * Step 3.5 — PERMISSION SETS. Additive, per-user, Salesforce semantics.
   *
   * AFTER the override's `allowedMytrions` REPLACE, not before. A set is assigned to a person, so it
   * is exactly as specific as an override; folding it in earlier would mean "assign Billing Read
   * Only to Bob" silently does nothing whenever Bob has any override row at all — the same class of
   * bug this file's header already records for a grant that was computed and then thrown away.
   *
   * BEFORE the deny subtraction in Step 5, so an admin keeps a surgical way to remove one Mytrion
   * from someone who holds it through a set.
   */
  const legacyGranted = [...allowed];
  for (const set of sets) allowed = unionMytrions(allowed, set.allowedMytrions);

  // Step 4 — BREAK-GLASS FLOOR: only an env-named user's all-access is immovable by the DB. A
  // profile/role marker admin is NOT pinned here any more — see the header.
  if (breakGlass) allDept = true;

  // Step 5 — accessible set. Only break-glass users are EXEMPT from the deny-list.
  const fullSet = allDept ? [...MYTRION_IDS] : allowed;
  const accessible = breakGlass ? fullSet : subtract(fullSet, denied);

  // `allDepartmentAccess: true` is a FULL bypass in every backend gate, so it can't express
  // "everything except X". A non-env-admin all-access grant WITH denies is downgraded to an
  // explicit department grant so the deny actually enforces (not just hidden in the UI list).
  const enforceableAllDept = allDept && (breakGlass || denied.length === 0);
  const roleModes = haveRd && rd ? (rd.mytrionAccessModes ?? {}) : {};
  return {
    value: {
      accessibleMytrions: accessible,
      homeMytrion: pickHome(home, accessible),
      allDepartmentAccess: enforceableAllDept,
      departments: enforceableAllDept ? [] : departmentsForMytrions(accessible),
      viewAsUserIds,
      mytrionAccessModes: resolveModes(
        accessible,
        enforceableAllDept || breakGlass,
        roleModes,
        userModes,
        sets,
      ),
      // An all-access grant means all tabs. Leaving stale scoping on an admin is a support ticket.
      mytrionTabGrants:
        enforceableAllDept || breakGlass ? {} : resolveTabGrants(accessible, legacyGranted, sets),
    },
    degraded: false,
  };
}

/**
 * Permission-set reads FAIL SOFT, on their own.
 *
 * Unlike the other three, these two queries are unconditional — there is no "only if the worker has
 * a profile name" shortcut — so letting them share the outer catch would mean an unreachable
 * permission-set table degrades EVERY user to `legacyAccess`, which grants far less and (by design)
 * never grants Customer Service. The realistic way to hit that is deploying this code before running
 * migration 0114: access would quietly collapse org-wide, and the logs would say "resolve failed"
 * rather than "the new tables are missing".
 *
 * Sets are purely ADDITIVE, so resolving without them is a correct, strictly-narrower answer. Losing
 * the whole grant chain instead is not.
 */
function setsUnavailable(what: string): (err: unknown) => never[] {
  return (err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), what },
      'permission set read failed — resolving without sets (grants from the other layers stand)',
    );
    return [];
  };
}

async function computeAccess(input: ResolveWorkerAccessInput): Promise<ComputeResult> {
  // Only used for the DB-error fallback below: with no tables readable we cannot honour an
  // override, so a marker admin falls back to all-access rather than to nothing.
  const envAdmin = resolveAllDepartmentAccess({
    profile: input.profileName ?? null,
    role: input.zohoRole ?? null,
    userName: input.userName ?? null,
  });
  const ctx = internalCtx(input.tenantId);

  try {
    /**
     * FIVE-way parallel, not sequential.
     *
     * The obvious shape — read this worker's assignments, then fetch those sets by id — doubles
     * cache-miss latency on the hot auth path, which runs per request behind a 10s TTL. `listActive`
     * is a small tenant-wide read of the same character as the profile-defaults list that
     * `resolveBatch` already does per call, so fetching all of them and filtering in memory is one
     * round trip instead of two.
     */
    const [pd, rd, ov, assignments, allSets] = await Promise.all([
      input.profileName != null
        ? mytrionProfileDefaultsRepo.findByKey(ctx, profileKeyOf(input.profileName))
        : Promise.resolve(undefined),
      input.zohoRole != null && input.zohoRole.trim() !== ''
        ? mytrionRoleDefaultsRepo.findByKey(ctx, roleKeyOf(input.zohoRole))
        : Promise.resolve(undefined),
      input.zohoUserId
        ? workerMytrionAccessRepo.findByZohoUserId(ctx, input.zohoUserId)
        : Promise.resolve(undefined),
      input.zohoUserId
        ? mytrionPermissionSetAssignmentsRepo.listByZohoUserId(ctx, input.zohoUserId).catch(setsUnavailable('assignments'))
        : Promise.resolve([]),
      mytrionPermissionSetsRepo.listActive(ctx).catch(setsUnavailable('sets')),
    ]);
    return combineAccess(input, pd, rd, ov, filterAssignedSets(allSets, assignments));
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
 * Customer Service Mytrion is NEVER granted here — Admin Profile/Role Defaults / per-user only.
 */
function legacyAccess(input: ResolveWorkerAccessInput, envAdmin: boolean): ResolvedAccess {
  if (envAdmin) {
    return {
      accessibleMytrions: [...MYTRION_IDS],
      homeMytrion: null,
      allDepartmentAccess: true,
      departments: [],
      viewAsUserIds: [],
      mytrionAccessModes: resolveModes([...MYTRION_IDS], true, {}, {}),
      mytrionTabGrants: {},
    };
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
    // The legacy fallback predates permission sets and cannot read them (it is the no-DB path).
    mytrionTabGrants: {},
    mytrionAccessModes: resolveModes(accessible, false, {}, {}),
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
   * Resolve MANY workers' access at once from bulk queries (profile + role defaults + overrides) —
   * used by the admin listing endpoint so listing N users costs O(1) DB round trips instead of the
   * per-user resolver's 3N. Also warms the per-user TTL cache.
   */
  async resolveBatch(
    tenantId: string,
    users: ResolveWorkerAccessInput[],
    prefetchedOverrides?: WorkerMytrionAccessDto[],
  ): Promise<Map<string, ResolvedAccess>> {
    const ctx = internalCtx(tenantId);
    // Five bulk reads for N users, not 5N. The whole point of this path.
    const [profileDefaults, roleDefaults, overrides, assignments, allSets] = await Promise.all([
      mytrionProfileDefaultsRepo.list(ctx),
      mytrionRoleDefaultsRepo.list(ctx),
      prefetchedOverrides ?? workerMytrionAccessRepo.list(ctx),
      mytrionPermissionSetAssignmentsRepo.listAllActive(ctx).catch(setsUnavailable('assignments')),
      mytrionPermissionSetsRepo.listActive(ctx).catch(setsUnavailable('sets')),
    ]);
    const pdByKey = new Map(profileDefaults.map((p) => [p.profileKey, p]));
    const rdByKey = new Map(roleDefaults.map((r) => [r.roleKey, r]));
    const ovById = new Map(overrides.map((o) => [o.zohoUserId, o]));
    const assignmentsByUser = new Map<string, { permissionSetId: string }[]>();
    for (const a of assignments) {
      const list = assignmentsByUser.get(a.zohoUserId) ?? [];
      list.push(a);
      assignmentsByUser.set(a.zohoUserId, list);
    }

    const result = new Map<string, ResolvedAccess>();
    for (const input of users) {
      const pd = input.profileName != null ? pdByKey.get(profileKeyOf(input.profileName)) : undefined;
      const rd =
        input.zohoRole != null && input.zohoRole.trim() !== ''
          ? rdByKey.get(roleKeyOf(input.zohoRole))
          : undefined;
      const ov = ovById.get(input.zohoUserId);
      const sets = filterAssignedSets(allSets, assignmentsByUser.get(input.zohoUserId) ?? []);
      const { value, degraded } = combineAccess(input, pd, rd, ov, sets);
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
   * Seed DEFAULT_PROFILE_SEED for a tenant (idempotent). Empty tenants get the full seed.
   * Already-seeded tenants only INSERT missing seed keys — existing admin edits are never
   * overwritten. Called at boot (modules/access/bootstrap.ts) and by GET /admin/mytrion-access/profiles.
   */
  async ensureProfileDefaultsSeeded(tenantId: string): Promise<MytrionProfileDefaultDto[]> {
    const ctx = internalCtx(tenantId);
    const existing = await mytrionProfileDefaultsRepo.list(ctx);
    const existingKeys = new Set(existing.map((row) => row.profileKey));
    let inserted = 0;
    for (const seed of DEFAULT_PROFILE_SEED) {
      const key = profileKeyOf(seed.profileName);
      if (existingKeys.has(key)) continue;
      await mytrionProfileDefaultsRepo.upsert(ctx, {
        profileName: seed.profileName,
        allowedMytrions: seed.allowedMytrions,
        homeMytrion: seed.homeMytrion,
        allDepartmentAccess: seed.allDepartmentAccess,
      });
      inserted += 1;
    }
    if (inserted > 0) {
      this.invalidateAll();
      logger.info({ tenantId, inserted }, 'mytrion access: backfilled missing profile defaults from seed');
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

  /** Clear the whole cache (call after a profile/role-default change — it affects many users). */
  invalidateAll(): void {
    cache.clear();
    lastGood.clear();
  },
};
